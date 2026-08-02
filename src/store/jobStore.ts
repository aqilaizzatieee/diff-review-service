import { Job, JobEvent, Finding, Usage, ReviewOptions, ParsedFile } from "../types";

interface CachedResult {
  findings: Finding[];
  usage: Usage;
}

const jobs = new Map<string, Job>();
// bodyHash -> cached result. Used to satisfy "byte-identical {diff,options}
// submitted again must not redo the work", independent of idempotency keys.
const resultCache = new Map<string, CachedResult>();
// idempotencyKey -> {bodyHash, jobId}. Used to satisfy "same key + same
// body -> same jobId; same key + different body -> 409".
const idempotencyMap = new Map<string, { bodyHash: string; jobId: string }>();

export function createJob(
  id: string,
  diff: string,
  options: ReviewOptions,
  bodyHash: string,
  files: ParsedFile[],
  inputBytes: number,
  chunks: number
): Job {
  const job: Job = {
    id,
    status: "queued",
    diff,
    options,
    bodyHash,
    files,
    findings: [],
    usage: { inputBytes, chunks, cacheHit: false },
    events: [],
    subscribers: new Set(),
    createdAt: Date.now(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function publish(job: Job, evt: JobEvent) {
  job.events.push(evt);
  for (const sub of job.subscribers) {
    try {
      sub(evt);
    } catch {
      /* subscriber errors must never break job processing */
    }
  }
}

export function getCachedResult(bodyHash: string): CachedResult | undefined {
  return resultCache.get(bodyHash);
}

export function setCachedResult(bodyHash: string, result: CachedResult) {
  resultCache.set(bodyHash, result);
}

export function getIdempotencyEntry(key: string) {
  return idempotencyMap.get(key);
}

export function setIdempotencyEntry(key: string, bodyHash: string, jobId: string) {
  idempotencyMap.set(key, { bodyHash, jobId });
}
