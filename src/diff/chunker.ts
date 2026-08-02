import { ParsedFile } from "../types";
import { CONFIG } from "../config";

/**
 * Groups files into chunks of at most CONFIG.chunkBytes.
 * - Never splits a single file's diff across two chunks.
 * - A single file whose diff exceeds chunkBytes becomes its own
 *   (oversized) chunk, per spec.
 * Order of files is preserved so downstream aggregation stays deterministic.
 */
export function chunkFiles(files: ParsedFile[]): ParsedFile[][] {
  const chunks: ParsedFile[][] = [];
  let current: ParsedFile[] = [];
  let currentBytes = 0;

  for (const file of files) {
    if (current.length > 0 && currentBytes + file.bytes > CONFIG.chunkBytes) {
      chunks.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(file);
    currentBytes += file.bytes;
  }
  if (current.length > 0) chunks.push(current);

  return chunks;
}
