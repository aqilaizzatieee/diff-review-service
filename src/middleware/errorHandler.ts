import { Request, Response, NextFunction } from "express";
import { AppError } from "../types";

// Handles body-parser errors (bad JSON, payload too large) plus any
// AppError thrown deeper in the app. Always emits the required envelope
// and never lets an unhandled error crash the process / return raw HTML.
export function errorHandler(
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  if (err instanceof AppError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message },
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: { code: "payload_too_large", message: "Request body exceeds 1 MiB" },
    });
  }

  if (err?.type === "entity.parse.failed" || err instanceof SyntaxError) {
    return res.status(400).json({
      error: { code: "invalid_json", message: "Request body is not valid JSON" },
    });
  }

  console.error("Unhandled error:", err);
  return res.status(500).json({
    error: { code: "internal", message: "Internal server error" },
  });
}
