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

- **Chunking**: `tests/manual-test.mjs` covers the mock-rule fixture end to
  end; I additionally ran the same fixture repeated many times to produce a
  diff >64KiB and confirmed `usage.chunks > 1` while findings stayed
  byte-identical to the unchunked run. [TODO: confirm you actually ran this
  and note the result, or adjust if you tested differently.]
- **Caching**: automated in `manual-test.mjs` - same `{diff, options}`
  resubmitted reports `cacheHit: true` with identical findings.
- **Idempotency**: automated - same `Idempotency-Key` + same body returns
  the same `jobId`; same key + different body returns `409`.
- **SSE replay**: automated - after a job reaches `done`, reconnecting to
  `/stream` replays the full `finding`/`done` event sequence.
- **Concurrency**: automated - 5 jobs submitted simultaneously all reach
  `done` (4 processed concurrently, 5th queued, none dropped).
- **Rate limiting**: manually verified via the curl loop in README.md - 202s
  until the bucket empties, then 429 with `Retry-After`. [TODO: fill in
  what you actually observed.]
- **Auth**: automated - missing/wrong bearer token on `/v1/*` (including
  GET routes) returns 401; `/health` and `/spec` remain public.
- **Injection inertness**: the fixture diff includes an
  `ignore previous instructions` line; verified it produces a `MOCK-INJ`
  finding like any other rule and does not alter parsing, ordering, or any
  other rule's output.

## AI tools used

[TODO: describe what you actually used - e.g. "Built with Claude via
claude.ai chat, iterating file by file on the Express/TypeScript
implementation."]

## An AI suggestion I rejected, and why

[TODO: this needs to be genuine. One real candidate from this build: the
parser could have relied on a third-party diff-parsing npm package instead
of a hand-rolled parser. I'd lean toward writing this section around why
you (or I, if you want to keep this) chose to hand-roll `diff/parser.ts`
instead - it removes a dependency, and the format needed (exact new-file
line numbers per added line, raw per-file text for chunking) is narrow
enough that a general-purpose diff library would need post-processing
anyway. Feel free to replace this with a suggestion you genuinely rejected
while working through the build with me.]

## What I'd do next with more time

See "What I'd do next" in README.md:
- Persist state to Redis/Postgres instead of in-memory maps.
- Strengthen MOCK-004 detection for catch blocks that mix added and
  unchanged context lines.
- Tune rate-limit burst allowance against real traffic.
- Add structured per-job logging/metrics.
