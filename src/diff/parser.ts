import { AddedLine, ParsedFile } from "../types";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/**
 * Splits a unified diff into per-file blocks.
 * Prefers "diff --git" boundaries (standard git diff format). If none are
 * present, falls back to "--- " lines as boundaries (plain unified diff
 * with multiple files concatenated).
 */
function splitFileBlocks(diff: string): string[] {
  const lines = diff.split("\n");
  const hasGitHeaders = lines.some((l) => l.startsWith("diff --git "));
  const boundaryTest = hasGitHeaders
    ? (l: string) => l.startsWith("diff --git ")
    : (l: string) => l.startsWith("--- ");

  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (boundaryTest(line) && current.length > 0) {
      blocks.push(current.join("\n"));
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current.join("\n"));

  return blocks.filter((b) => b.trim().length > 0);
}

function extractPath(block: string): string | null {
  const lines = block.split("\n");
  for (const line of lines) {
    if (line.startsWith("+++ ")) {
      let p = line.slice(4).trim();
      // strip trailing tab-separated timestamp, if any
      p = p.split("\t")[0].trim();
      if (p === "/dev/null") continue;
      if (p.startsWith("b/")) p = p.slice(2);
      return p;
    }
  }
  // fall back to the "--- a/path" line (e.g. pure file deletions)
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      let p = line.slice(4).trim();
      p = p.split("\t")[0].trim();
      if (p === "/dev/null") continue;
      if (p.startsWith("a/")) p = p.slice(2);
      return p;
    }
  }
  return null;
}

function parseBlock(block: string): ParsedFile | null {
  const path = extractPath(block);
  if (!path) return null;

  const lines = block.split("\n");
  const addedLines: AddedLine[] = [];
  let curLine = -1;
  let inHunk = false;

  for (const line of lines) {
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      curLine = parseInt(hunkMatch[3], 10);
      inHunk = true;
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    } else if (line.startsWith("+")) {
      addedLines.push({ path, line: curLine, content: line.slice(1) });
      curLine++;
    } else if (line.startsWith("-")) {
      // removed line: does not exist in new file, don't advance curLine
    } else if (line.startsWith("\\")) {
      // "\ No newline at end of file" marker - ignore
    } else {
      // context line (starts with a space, or is blank inside a hunk)
      curLine++;
    }
  }

  return {
    path,
    raw: block,
    bytes: Buffer.byteLength(block, "utf8"),
    addedLines,
  };
}

/**
 * Parses a unified diff into per-file structures.
 * Throws if the input doesn't look like a parseable unified diff at all
 * (no file headers, no hunk headers anywhere) - caller should map that to
 * a 422 invalid_diff response.
 */
export function parseUnifiedDiff(diff: string): ParsedFile[] {
  if (!diff || typeof diff !== "string" || diff.trim().length === 0) {
    throw new Error("empty diff");
  }

  const blocks = splitFileBlocks(diff);
  if (blocks.length === 0) {
    throw new Error("no file blocks found");
  }

  const hasAnyHunk = diff
    .split("\n")
    .some((line) => HUNK_HEADER.test(line));
  if (!hasAnyHunk) {
    throw new Error("no valid hunk headers found - not a unified diff");
  }
  const files: ParsedFile[] = [];
  for (const block of blocks) {
    const parsed = parseBlock(block);
    if (parsed) files.push(parsed);
  }

  if (files.length === 0) {
    throw new Error("could not extract any file paths from diff");
  }

  return files;
}
