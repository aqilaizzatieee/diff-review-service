import { Router } from "express";
import { CONFIG } from "../config";

export const specRouter = Router();

specRouter.get("/spec", (_req, res) => {
  res.status(200).json({
    specVersion: "1.0",
    providers: ["mock", "llm"],
    limits: {
      maxPayloadBytes: CONFIG.maxPayloadBytes,
      chunkBytes: CONFIG.chunkBytes,
      maxConcurrentJobs: CONFIG.maxConcurrentJobs,
      rateLimitPerMinute: CONFIG.rateLimitPerMinute,
    },
  });
});
