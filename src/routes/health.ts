import { Router } from "express";
import { CONFIG } from "../config";

export const healthRouter = Router();

healthRouter.get("/health", (_req, res) => {
  res.status(200).json({
    status: "ok",
    version: CONFIG.version,
    uptimeSeconds: Math.floor((Date.now() - CONFIG.startedAt) / 1000),
  });
});
