import "dotenv/config";
import express from "express";
import { CONFIG } from "./config";
import { healthRouter } from "./routes/health";
import { specRouter } from "./routes/spec";
import { reviewsRouter } from "./routes/reviews";
import { requireAuth } from "./middleware/auth";
import { errorHandler } from "./middleware/errorHandler";

const app = express();

// Public routes - no auth required.
app.use(healthRouter);
app.use(specRouter);

// All /v1/* routes require auth, including GETs, per spec. Auth is checked
// BEFORE body parsing so a bad/missing token always yields 401, even if
// the body also happens to be malformed JSON.
app.use(
  "/v1",
  requireAuth,
  // Body parsing with the declared payload limit. Oversized bodies throw
  // entity.too.large, invalid JSON throws entity.parse.failed - both are
  // caught by errorHandler below and mapped to the right envelope.
  express.json({ limit: CONFIG.maxPayloadBytes, strict: true }),
  reviewsRouter
);

// Catch-all for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: { code: "not_found", message: "No such route" } });
});

// Central error handler - must be registered last.
app.use(errorHandler);

// Wrap async route handlers so thrown/rejected errors reach errorHandler
// instead of crashing the process. (Express 4 doesn't auto-catch async
// throws - reviews.ts throws synchronously inside the handler body before
// any await, which Express 4 does catch natively; this is a defensive
// safety net for anything added later.)
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`diff-review-service listening on port ${port}`);
});
