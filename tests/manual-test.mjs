// Manual verification script.
// Usage: BASE_URL=http://localhost:3000 TOKEN=your-token node tests/manual-test.mjs
// Requires Node 18+ (uses global fetch).

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.BASE_URL || "http://localhost:3000";
const TOKEN = process.env.TOKEN || "change-me";

let pass = 0;
let fail = 0;

function ok(label, cond, extra = "") {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label} ${extra}`);
  }
}

async function j(method, urlPath, { body, headers = {}, auth = true, raw } = {}) {
  const res = await fetch(BASE + urlPath, {
    method,
    headers: {
      ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* not json, e.g. SSE or empty */
  }
  return { status: res.status, headers: res.headers, data };
}

async function pollUntilDone(jobId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { data } = await j("GET", `/v1/reviews/${jobId}`);
    if (data.status === "done" || data.status === "failed") return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("timed out waiting for job to finish");
}

async function main() {
  console.log(`\nTesting ${BASE}\n`);

  // --- health / spec (public) ---
  console.log("health & spec:");
  {
    const h = await j("GET", "/health", { auth: false });
    ok("GET /health -> 200", h.status === 200);
    ok("health has status ok", h.data?.status === "ok");

    const s = await j("GET", "/spec", { auth: false });
    ok("GET /spec -> 200", s.status === 200);
    ok("spec declares mock+llm providers", (s.data?.providers || []).includes("mock") && s.data.providers.includes("llm"));
  }

  // --- auth ---
  console.log("\nauth:");
  {
    const noToken = await j("GET", "/v1/reviews/nonexistent", { auth: false });
    ok("GET /v1/* without token -> 401", noToken.status === 401);
    ok("401 has error envelope", noToken.data?.error?.code === "unauthorized");

    const badToken = await j("GET", "/v1/reviews/nonexistent", {
      auth: true,
      headers: { Authorization: "Bearer wrong-token" },
    });
    ok("GET /v1/* with wrong token -> 401", badToken.status === 401);
  }

  // --- validation errors ---
  console.log("\nvalidation:");
  {
    const badJson = await j("POST", "/v1/reviews", { raw: "{not json" });
    ok("malformed JSON -> 400 invalid_json", badJson.status === 400 && badJson.data?.error?.code === "invalid_json");

    const emptyDiff = await j("POST", "/v1/reviews", { body: { diff: "" } });
    ok("empty diff -> 422 invalid_diff", emptyDiff.status === 422 && emptyDiff.data?.error?.code === "invalid_diff");

    const notADiff = await j("POST", "/v1/reviews", { body: { diff: "hello world, not a diff" } });
    ok("unparseable diff -> 422 invalid_diff", notADiff.status === 422 && notADiff.data?.error?.code === "invalid_diff");

    const big = "a".repeat(1024 * 1024 + 10);
    const oversized = await j("POST", "/v1/reviews", { body: { diff: big } });
    ok("oversized payload -> 413", oversized.status === 413, `got ${oversized.status}`);
  }

  // --- mock rules on crafted fixture ---
  console.log("\nmock rules:");
  const fixture = fs.readFileSync(path.join(__dirname, "fixtures/all-rules.diff"), "utf8");
  let jobId;
  {
    const submit = await j("POST", "/v1/reviews", { body: { diff: fixture, options: { provider: "mock" } } });
    ok("submit -> 202", submit.status === 202);
    jobId = submit.data.jobId;

    const result = await pollUntilDone(jobId);
    ok("job reaches done", result.status === "done", `status=${result.status}`);

    const ruleIds = new Set((result.findings || []).map((f) => f.ruleId));
    for (const expected of [
      "MOCK-001",
      "MOCK-002",
      "MOCK-003",
      "MOCK-004",
      "MOCK-005",
      "MOCK-006",
      "MOCK-007",
      "MOCK-008",
      "MOCK-INJ",
    ]) {
      ok(`fixture triggers ${expected}`, ruleIds.has(expected));
    }

    const findings = result.findings || [];
    const sorted = [...findings].sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      if (a.line !== b.line) return a.line - b.line;
      return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    });
    ok("findings are correctly ordered", JSON.stringify(findings) === JSON.stringify(sorted));

    const ids = findings.map((f) => f.id);
    ok("findings are deduplicated", new Set(ids).size === ids.length);
  }

  // --- caching ---
  console.log("\ncaching:");
  {
    const first = await j("POST", "/v1/reviews", { body: { diff: fixture, options: { provider: "mock" } } });
    const firstResult = await pollUntilDone(first.data.jobId);
    const second = await j("POST", "/v1/reviews", { body: { diff: fixture, options: { provider: "mock" } } });
    const secondResult = await pollUntilDone(second.data.jobId);
    ok("repeat submission -> cacheHit true", secondResult.usage?.cacheHit === true);
    ok(
      "cached findings identical",
      JSON.stringify(firstResult.findings) === JSON.stringify(secondResult.findings)
    );
  }

  // --- idempotency ---
  console.log("\nidempotency:");
  {
    const key = "idem-test-" + Date.now();
    const r1 = await j("POST", "/v1/reviews", { body: { diff: fixture }, headers: { "Idempotency-Key": key } });
    const r2 = await j("POST", "/v1/reviews", { body: { diff: fixture }, headers: { "Idempotency-Key": key } });
    ok("same key + same body -> same jobId", r1.data.jobId === r2.data.jobId);

    const r3 = await j("POST", "/v1/reviews", {
      body: { diff: fixture + "\n" },
      headers: { "Idempotency-Key": key },
    });
    ok("same key + different body -> 409", r3.status === 409 && r3.data?.error?.code === "idempotency_conflict");
  }

  // --- SSE replay ---
  console.log("\nSSE:");
  {
    const res = await fetch(`${BASE}/v1/reviews/${jobId}/stream`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
    });
    const text = await res.text();
    ok("stream content-type is text/event-stream", (res.headers.get("content-type") || "").includes("text/event-stream"));
    ok("finished job stream replays finding events", text.includes("event: finding"));
    ok("finished job stream replays done event", text.includes("event: done"));
  }

  // --- concurrency: 5 jobs at once shouldn't fail the 5th ---
  console.log("\nconcurrency:");
  {
    const submissions = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        j("POST", "/v1/reviews", { body: { diff: fixture + `\n// nonce-${Math.random()}` } })
      )
    );
    ok("5 concurrent submissions all accepted (202)", submissions.every((s) => s.status === 202));
    const results = await Promise.all(submissions.map((s) => pollUntilDone(s.data.jobId)));
    ok("all 5 concurrent jobs complete", results.every((r) => r.status === "done"));
  }

  // --- 404 ---
  console.log("\nnot found:");
  {
    const nf = await j("GET", "/v1/reviews/does-not-exist");
    ok("unknown jobId -> 404", nf.status === 404 && nf.data?.error?.code === "not_found");
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Test script crashed:", err);
  process.exit(1);
});
