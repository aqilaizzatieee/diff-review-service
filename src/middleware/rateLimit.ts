import { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config";

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

const CAPACITY = CONFIG.rateLimitPerMinute + CONFIG.burstAllowance;
const REFILL_PER_MS = CONFIG.rateLimitPerMinute / 60000; // tokens per ms

function getBucket(key: string): Bucket {
  let b = buckets.get(key);
  if (!b) {
    b = { tokens: CAPACITY, lastRefill: Date.now() };
    buckets.set(key, b);
  }
  return b;
}

function refill(b: Bucket) {
  const now = Date.now();
  const elapsed = now - b.lastRefill;
  if (elapsed <= 0) return;
  b.tokens = Math.min(CAPACITY, b.tokens + elapsed * REFILL_PER_MS);
  b.lastRefill = now;
}

// Only applied to POST /v1/reviews - GETs are never rate limited, per spec.
export function reviewsRateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.header("Authorization") || "anon";
  const bucket = getBucket(key);
  refill(bucket);

  if (bucket.tokens < 1) {
    const msUntilNextToken = (1 - bucket.tokens) / REFILL_PER_MS;
    const retryAfterSeconds = Math.max(1, Math.ceil(msUntilNextToken / 1000));
    res.setHeader("Retry-After", String(retryAfterSeconds));
    return res.status(429).json({
      error: { code: "rate_limited", message: "Too many requests, slow down" },
    });
  }

  bucket.tokens -= 1;
  next();
}
