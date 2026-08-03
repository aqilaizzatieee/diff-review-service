# SUBMISSION.md

## Architecture

See the "Architecture" section in README.md for the full walkthrough. In
short: `diff parser -> chunker -> rule engine/provider -> job store -> SSE`,
with a concurrency-limited runner in between that also handles the
cache/idempotency fast paths.

## Provider design

See "Provider design" in README.md. Both `mock` and `llm` implement the same
`(files) => Finding[]` interface so the pipeline is provider-agnostic; `llm`
degrades to a `failed` job with a clear error on any failure instead of
crashing.

## How I verified the cross-cutting behaviors

Chunking: Verified using `tests/manual-test.mjs` for the mock-rule fixture end-to-end. Additionally, I tested chunking by duplicating the fixture diff until the overall payload exceeded 64 KiB. I confirmed that `usage.chunks` increased to 2 while the generated findings remained byte-identical to the unchunked scan, proving that file boundaries and finding order were preserved correctly.  

Caching: Automated via `manual-test.mjs` — resubmitting an identical `{diff, options}` payload correctly reports `cacheHit: true` with identical findings.  

Idempotency: Automated via `manual-test.mjs` — submitting with the same Idempotency-Key and body returns the original `jobId`, while using the same key with a modified body correctly triggers a `409 Conflict` response.  

SSE Replay: Automated via `manual-test.mj`s — once a review job reaches done, reconnecting to /stream successfully replays the entire recorded event sequence (status, finding, and done).  

Concurrency: Automated via `manual-test.mjs` — sending 5 concurrent review jobs resulted in all 5 reaching done state successfully (4 processed in parallel while the 5th queued without dropping).  

Rate Limiting: Manually verified using a `curl` loop sending rapid POST requests. The service accepted the initial burst with `202 Accepted `status codes until the bucket emptied, after which it returned 429 Too Many Requests with a valid Retry-After header.  

Auth: Automated via `manual-test.mjs` — all `/v1/* routes` (including GET endpoints) reject requests with missing or invalid Bearer tokens with a `401 Unauthorized` error, while `/health` and `/spec` remain publicly accessible.  

Injection Inertness: The test diff fixture includes prompt-injection text (`ignore previous instructions`). Verified that it safely produces a MOCK-INJ finding as inert text without altering diff parsing, rule evaluation, or job execution.

## AI tools used

I developed this using Claude to generate the initial TypeScript implementation and build a custom test script. Working with AI helped me quickly catch and fix edge-case bugs in the diff parser and response-ordering logic. I also used Gemini as an architectural assistant to review the project guidelines and plan the deployment

## An AI suggestion I rejected, and why

The default service design includes both a mock provider and a real llm provider using the Anthropic API. Although connecting a live API key would have made a nice demo, I decided against it. The assignment instructions clearly state that only the mock provider is evaluated for scoring, while the llm path simply needs to handle errors properly if it isn't set up. Adding an external dependency or spending money on an unscored feature was not the right trade-off. Instead, I tested the error handling directly. Requesting the llm provider correctly returns a failed status with a clear error message, without crashing the application.

## What I'd do next with more time

- Persist state to Redis/Postgres instead of in-memory maps.
- Strengthen MOCK-004 detection for catch blocks that mix added and unchanged context lines.
- Tune rate-limit burst allowance against real traffic.
- Add structured per-job logging/metrics.
