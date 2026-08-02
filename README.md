# AI Diff Review Service

Implements the take-home contract: clients POST a unified diff, the service
reviews it asynchronously via a pluggable provider (`mock` or `llm`), and
returns structured findings, pollable and streamable via SSE.

## Requirements

- Node.js 18+ (uses the global `fetch` API for the LLM provider)

## Setup

```bash
npm install
cp .env.example .env
# edit .env: set BEARER_TOKEN to a random secret, e.g.
#   openssl rand -hex 24
```

## Run locally

```bash
npm run dev       # ts-node-dev, auto-restarts on change
# or
npm run build && npm start
```

Server listens on `PORT` (default 3000).

## Verify it works

With the server running in one terminal:

```bash
BASE_URL=http://localhost:3000 TOKEN=<your BEARER_TOKEN> npm run test:manual
```

This exercises: health/spec, auth on all `/v1` routes, every mock rule via a
crafted fixture diff, ordering/dedup, caching, idempotency (same key/body vs.
same key/different body), SSE replay, 5-way concurrency, and 404 handling.

Two things the script does **not** cover automatically (test these manually,
see below): sustained rate limiting (30/min + burst → 429) and the `llm`
provider path (requires `ANTHROPIC_API_KEY`).

### Manually verify rate limiting

```bash
for i in $(seq 1 45); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/v1/reviews \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"diff":"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n+new\n"}'
done
```

You should see `202` for the first ~30-40, then `429` with a `Retry-After`
header once the bucket empties.

### Manually verify the LLM path

```bash
# set ANTHROPIC_API_KEY in .env, restart the server, then:
curl -X POST http://localhost:3000/v1/reviews \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"diff":"...", "options":{"provider":"llm"}}'
# poll the returned jobId - should reach "done" with model-generated findings.

# then unset the key / stop the model server and confirm it fails gracefully:
# the job should reach "status":"failed" with a clear error, not crash the process.
```

## Architecture (10 lines)

`diff/parser.ts` turns a unified diff into per-file structures with correct
new-file line numbers for added lines. `diff/chunker.ts` groups those files
into ≤64KiB chunks on file boundaries only. `rules/mockRules.ts` is the
deterministic rule engine (9 rules); `providers/mock.ts` and
`providers/llm.ts` share the same `(files) => Finding[]` interface, so the
pipeline runner (`pipeline/runner.ts`) doesn't care which one it's calling.
The runner is a hand-rolled semaphore queue capped at 4 concurrent jobs;
processing a job chunks the diff, runs the provider per chunk, then merges,
dedupes, sorts, and truncates to `maxFindings`. `store/jobStore.ts` holds
jobs, a `bodyHash -> result` cache (for byte-identical resubmission), and an
`idempotencyKey -> {bodyHash, jobId}` map (kept intentionally separate from
the cache, since they answer different questions). SSE just replays a job's
recorded event log, then live-forwards new events via a subscriber set.

## Provider design

Both providers implement `(files: ParsedFile[]) => Promise<Finding[]>` and
are called identically by the runner, per chunk. `mock` is pure
pattern-matching over already-parsed added lines - no state, no I/O, fully
deterministic. `llm` sends the raw diff chunk to Anthropic's API with a
system prompt that explicitly tells the model to treat diff content as data,
never as instructions (this is a secondary defense; the primary defense
against prompt injection is that neither provider's *code path* branches on
diff content in a way that could change service behavior - `mockRules.ts`
only ever uses line content for regex matching). Any LLM failure (missing
key, network error, bad response, unparseable output) raises a typed
`ProviderError`, caught by the runner and turned into a `failed` job with a
`code`/`message` - never an uncaught exception.

## What I'd do next with more time

- Persist jobs/cache to a real store (Redis or Postgres) - right now
  everything is in-memory and lost on restart.
- Smarter MOCK-004 (empty catch) detection - the current heuristic only
  looks at *added* lines contiguous in the new file; a catch block that
  mixes added and unchanged lines could be missed.
- Per-IP or per-key rate limit tuning based on real traffic patterns instead
  of a fixed burst constant.
- Structured logging/metrics per job (latency, chunk count, provider used)
  for observability.
