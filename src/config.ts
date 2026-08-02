export const CONFIG = {
  version: "1.0.0",
  startedAt: Date.now(),
  bearerToken: process.env.BEARER_TOKEN || "change-me",
  maxPayloadBytes: 1048576, // 1 MiB
  chunkBytes: 65536, // 64 KiB
  maxConcurrentJobs: 4,
  rateLimitPerMinute: 30,
  // Extra burst allowed above the steady 30/min rate before we start 429ing.
  // Chosen so "sustained 30/min succeeds" while still giving headroom for
  // a legitimate short burst, per the contract's rate limiting section.
  burstAllowance: 10,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
};
