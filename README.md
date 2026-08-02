# AI Diff Review Service

Helloo! This project implements the AI Diff Review Service. Clients submit a unified diff, the service reviews it asynchronously using a pluggable provider (`mock` or `llm`), and returns structured findings that can be retrieved by polling or streamed via SSE.

## Requirements

* Node.js 18 or later (uses the global `fetch` API for the LLM provider)

## Getting Started

```bash
npm install
cp .env.example .env

# Edit .env and set BEARER_TOKEN to a random secret, for example:
# openssl rand -hex 24
```

## Running the Service

```bash
npm run dev       # Development mode with auto reload

# or

npm run build && npm start
```

The server listens on `PORT`, which defaults to `3000`.

## Quick Verification

With the server running in another terminal:

```bash
BASE_URL=http://localhost:3000 TOKEN=<your BEARER_TOKEN> npm run test:manual
```

The script exercises:

* Health and specification endpoints
* Authentication across all `/v1` routes
* Every mock review rule using fixture diffs
* Result ordering and deduplication
* Response caching
* Idempotency behavior
* SSE replay
* Five concurrent jobs
* 404 handling

The script intentionally leaves two scenarios for manual testing:

* Sustained rate limiting (30 requests per minute leading to `429`)
* The `llm` provider, which requires `ANTHROPIC_API_KEY`

### Verify Rate Limiting

```bash
for i in $(seq 1 45); do
  curl -s -o /dev/null -w "%{http_code}\n" \
    -X POST http://localhost:3000/v1/reviews \
    -H "Authorization: Bearer <token>" \
    -H "Content-Type: application/json" \
    -d '{"diff":"diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,1 +1,1 @@\n-old\n+new\n"}'
done
```

You should receive `202` responses and then  `429` once the rate limit is exceeded.

### Verify the LLM Provider

```bash
# Set ANTHROPIC_API_KEY in .env and restart the server.

curl -X POST http://localhost:3000/v1/reviews \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"diff":"...", "options":{"provider":"llm"}}'
```

Poll the returned `jobId`. The job should complete successfully with model generated findings.

Then remove the API key or make the provider unavailable. The job should transition to `"status":"failed"` with a clear error message while the service continues running normally.

## Architecture

`diff/parser.ts` converts a unified diff into per file structures while preserving correct line numbers for added lines. `diff/chunker.ts` groups files into chunks of up to 64 KiB without splitting files.

The review pipeline is provider agnostic. Both `providers/mock.ts` and `providers/llm.ts` implement the same interface, allowing `pipeline/runner.ts` to process either provider without special handling. Jobs are processed through a semaphore limited to four concurrent workers. Results from each chunk are merged, deduplicated, sorted, and capped at `maxFindings`.

`store/jobStore.ts` manages job state, response caching for identical submissions, and idempotency tracking. SSE clients receive the complete event history when they connect, followed by live updates as processing continues.

## Provider Design

Both providers implement `Promise<Finding[]>` over parsed files and are invoked identically by the pipeline.

The `mock` provider performs deterministic pattern matching against added lines and contains no external dependencies.

The `llm` provider submits each diff chunk to Anthropic with a system prompt that treats diff content strictly as data rather than instructions. As an additional safeguard, service behavior never branches on diff content itself. Any provider failure, including missing credentials, network issues, invalid responses, or parsing errors, is converted into a typed `ProviderError`. The pipeline reports these as failed jobs with structured error information rather than allowing uncaught exceptions.

## Future Improvements

Given more time, I would prioritize:

* Persisting jobs and caches in Redis or PostgreSQL instead of memory.
* Improving `MOCK-004` detection to handle mixed added and unchanged lines within `catch` blocks.
* Refining rate limiting based on production traffic patterns instead of a fixed burst threshold.
* Adding structured logging and metrics for latency, chunk processing, provider usage, and overall observability.

