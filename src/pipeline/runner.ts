import { Job, Finding } from "../types";
import { CONFIG } from "../config";
import { chunkFiles } from "../diff/chunker";
import { runMockProvider } from "../providers/mock";
import { runLLMProvider, ProviderError } from "../providers/llm";
import { publish, getCachedResult, setCachedResult } from "../store/jobStore";

const queue: string[] = [];
const jobsById = new Map<string, Job>();
let activeCount = 0;

function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    out.push(f);
  }
  return out;
}

async function processJob(job: Job) {
  // Fast path: identical {diff, options} already computed. Skip provider
  // work entirely - this both satisfies "must not redo the work" and
  // keeps cache hits from consuming a concurrency slot's worth of time.
  const cached = getCachedResult(job.bodyHash);
  if (cached) {
    job.status = "running";
    publish(job, { event: "status", data: { status: "running" } });
    for (const f of cached.findings) {
      publish(job, { event: "finding", data: f });
    }
    job.findings = cached.findings;
    job.usage = { ...cached.usage, cacheHit: true };
    job.status = "done";
    publish(job, {
      event: "done",
      data: { total: job.findings.length, usage: job.usage },
    });
    return;
  }

  job.status = "running";
  publish(job, { event: "status", data: { status: "running" } });

  try {
    const files = job.files!;
    const chunks = chunkFiles(files);
    let allFindings: Finding[] = [];

    for (const chunk of chunks) {
      const chunkFindings =
        job.options.provider === "llm"
          ? await runLLMProvider(chunk)
          : await runMockProvider(chunk);
      allFindings = allFindings.concat(chunkFindings);
    }

    allFindings = sortFindings(dedupe(allFindings));

    const usage = {
      inputBytes: Buffer.byteLength(job.diff, "utf8"),
      chunks: chunks.length,
      cacheHit: false,
    };

    // Cache the full (already maxFindings-scoped, since options are part
    // of the cache key) result for future identical submissions.
    const truncated = allFindings.slice(0, job.options.maxFindings);
    setCachedResult(job.bodyHash, { findings: truncated, usage });

    for (const f of truncated) {
      publish(job, { event: "finding", data: f });
    }

    job.findings = truncated;
    job.usage = usage;
    job.status = "done";
    publish(job, {
      event: "done",
      data: { total: truncated.length, usage },
    });
  } catch (err: any) {
    const code = err instanceof ProviderError ? err.code : "internal";
    const message = err?.message || "unexpected error while processing job";
    job.status = "failed";
    job.error = { code, message };
    publish(job, { event: "status", data: { status: "failed", error: job.error } });
  }
}

function pump() {
  while (activeCount < CONFIG.maxConcurrentJobs && queue.length > 0) {
    const jobId = queue.shift()!;
    const job = jobsById.get(jobId);
    jobsById.delete(jobId);
    if (!job) continue;
    activeCount++;
    processJob(job).finally(() => {
      activeCount--;
      pump();
    });
  }
}

export function enqueue(job: Job) {
  jobsById.set(job.id, job);
  queue.push(job.id);
  pump();
}
