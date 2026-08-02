import { Router, Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { AppError, ReviewOptions } from "../types";
import { parseUnifiedDiff } from "../diff/parser";
import { hashBody } from "../utils/hash";
import {
  createJob,
  getJob,
  getIdempotencyEntry,
  setIdempotencyEntry,
} from "../store/jobStore";
import { enqueue } from "../pipeline/runner";
import { reviewsRateLimit } from "../middleware/rateLimit";

export const reviewsRouter = Router();

function parseOptions(body: any): ReviewOptions {
  const provider = body?.options?.provider === "llm" ? "llm" : "mock";
  let maxFindings = 100;
  if (
    typeof body?.options?.maxFindings === "number" &&
    Number.isFinite(body.options.maxFindings) &&
    body.options.maxFindings >= 0
  ) {
    maxFindings = Math.floor(body.options.maxFindings);
  }
  return { provider, maxFindings };
}

reviewsRouter.post("/reviews", reviewsRateLimit, (req: Request, res: Response) => {
  const body = req.body;

  if (!body || typeof body !== "object") {
    throw new AppError("invalid_json", 400, "Request body must be a JSON object");
  }

  const diff = body.diff;
  if (typeof diff !== "string" || diff.trim().length === 0) {
    throw new AppError("invalid_diff", 422, "'diff' is required and must be a non-empty string");
  }

  const options = parseOptions(body);

  let files;
  try {
    files = parseUnifiedDiff(diff);
  } catch (err: any) {
    throw new AppError(
      "invalid_diff",
      422,
      `'diff' could not be parsed as a unified diff: ${err?.message || "unknown error"}`
    );
  }

  const bodyHash = hashBody(diff, options);
  const idempotencyKey = req.header("Idempotency-Key");

  if (idempotencyKey) {
    const existing = getIdempotencyEntry(idempotencyKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) {
        throw new AppError(
          "idempotency_conflict",
          409,
          "Idempotency-Key was already used with a different request body"
        );
      }
      const job = getJob(existing.jobId);
      return res.status(202).json({ jobId: existing.jobId, status: job?.status ?? "queued" });
    }
  }

  const jobId = uuidv4();
  const inputBytes = Buffer.byteLength(diff, "utf8");
  const job = createJob(jobId, diff, options, bodyHash, files, inputBytes, 0);

  if (idempotencyKey) {
    setIdempotencyEntry(idempotencyKey, bodyHash, jobId);
  }

res.status(202).json({ jobId, status: "queued" });
  enqueue(job);
});

reviewsRouter.get("/reviews/:jobId", (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    throw new AppError("not_found", 404, "No job with that id");
  }

  const response: any = {
    jobId: job.id,
    status: job.status,
    usage: job.usage,
  };
  if (job.status === "done") {
    response.findings = job.findings;
  }
  if (job.status === "failed" && job.error) {
    response.error = job.error;
  }

  res.status(200).json(response);
});

reviewsRouter.get("/reviews/:jobId/stream", (req: Request, res: Response) => {
  const job = getJob(req.params.jobId);
  if (!job) {
    throw new AppError("not_found", 404, "No job with that id");
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const write = (evt: { event: string; data: any }) => {
    res.write(`event: ${evt.event}\n`);
    res.write(`data: ${JSON.stringify(evt.data)}\n\n`);
  };

  // Replay every event recorded so far (works identically whether the job
  // is still in-flight or already finished - "connecting to a finished
  // job's stream must replay all events identically" is satisfied because
  // we always replay the full event log first).
  for (const evt of job.events) {
    write(evt);
  }

  if (job.status === "done" || job.status === "failed") {
    res.end();
    return;
  }

  const listener = (evt: { event: string; data: any }) => {
    write(evt);
    if (evt.event === "done") {
      job.subscribers.delete(listener);
      res.end();
    }
  };
  job.subscribers.add(listener);

  req.on("close", () => {
    job.subscribers.delete(listener);
  });
});
