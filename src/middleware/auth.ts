import { Request, Response, NextFunction } from "express";
import { CONFIG } from "../config";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.header("Authorization") || "";
  const match = /^Bearer\s+(.+)$/.exec(header);
  const token = match?.[1];

  if (!token || token !== CONFIG.bearerToken) {
    return res.status(401).json({
      error: { code: "unauthorized", message: "Missing or invalid bearer token" },
    });
  }
  next();
}
