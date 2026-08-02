import { AddedLine, Finding, ParsedFile, Severity, Category } from "../types";

interface SimpleRule {
  id: string;
  severity: Severity;
  category: Category;
  title: string;
  test: (line: string) => boolean;
}

// Rules 1,2,3,5,6,7,8,9: single-line, regex/substring based.
const SIMPLE_RULES: SimpleRule[] = [
  {
    id: "MOCK-001",
    severity: "critical",
    category: "security",
    title: "eval usage",
    test: (l) => l.includes("eval("),
  },
  {
    id: "MOCK-002",
    severity: "critical",
    category: "security",
    title: "hardcoded credential",
    test: (l) =>
      /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i.test(
        l
      ),
  },
  {
    id: "MOCK-003",
    severity: "high",
    category: "security",
    title: "SQL string concatenation",
    // A SQL keyword appears inside a quoted string, and that string is
    // concatenated with '+' either before or after the quote.
    test: (l) => {
      const kw = "(SELECT|INSERT|UPDATE|DELETE)";
      const inQuoteWithKeyword = new RegExp(
        `(['"])(?:(?!\\1).)*?${kw}(?:(?!\\1).)*?\\1`,
        "i"
      );
      if (!inQuoteWithKeyword.test(l)) return false;
      return l.includes("+");
    },
  },
  {
    id: "MOCK-005",
    severity: "medium",
    category: "correctness",
    title: "loose null comparison",
    test: (l) => /(==|!=)\s*null|null\s*(==|!=)/.test(l),
  },
  {
    id: "MOCK-006",
    severity: "medium",
    category: "performance",
    title: "deep-clone via JSON",
    test: (l) => l.includes("JSON.parse(JSON.stringify("),
  },
  {
    id: "MOCK-007",
    severity: "low",
    category: "style",
    title: "console.log left in",
    test: (l) => l.includes("console.log("),
  },
  {
    id: "MOCK-008",
    severity: "low",
    category: "style",
    title: "unresolved marker",
    test: (l) => /TODO|FIXME/.test(l),
  },
  {
    id: "MOCK-INJ",
    severity: "critical",
    category: "security",
    title: "prompt-injection content",
    test: (l) =>
      /ignore previous instructions|disregard all prior|you are now/i.test(
        l
      ),
  },
];

/**
 * MOCK-004: empty catch block. May span lines; report the `catch` line.
 * Heuristic: a line containing "catch" and "(" is a catch line. We look
 * ahead through the file's added lines (only lines that are contiguous in
 * the new file, i.e. actually adjacent added lines) for the block body.
 * If the first non-blank, non-comment content we find after the opening
 * brace is a bare closing brace, the catch block is empty.
 */
function findEmptyCatchBlocks(addedLines: AddedLine[]): AddedLine[] {
  const hits: AddedLine[] = [];
  const isCatchLine = (s: string) => /\bcatch\s*\(/.test(s);

  for (let i = 0; i < addedLines.length; i++) {
    const cur = addedLines[i];
    if (!isCatchLine(cur.content)) continue;

    const trimmed = cur.content.trim();
    // catch (e) {}  -- empty on the same line
    if (/\{\s*\}\s*;?\s*$/.test(trimmed)) {
      hits.push(cur);
      continue;
    }

    // Otherwise, walk forward through subsequent added lines that are
    // contiguous in the new file, skipping blank/comment-only lines,
    // to find the first substantive line.
    let j = i + 1;
    let expectedLine = cur.line + 1;
    let sawBody = false;
    while (j < addedLines.length && addedLines[j].line === expectedLine) {
      const t = addedLines[j].content.trim();
      if (t === "" || t.startsWith("//") || t === "{") {
        expectedLine++;
        j++;
        continue;
      }
      if (t === "}") {
        hits.push(cur);
      } else {
        sawBody = true;
      }
      break;
    }
    void sawBody;
  }
  return hits;
}

function makeFinding(
  ruleId: string,
  severity: Severity,
  category: Category,
  title: string,
  path: string,
  line: number,
  evidence: string
): Finding {
  return {
    id: `${ruleId}:${path}:${line}`,
    ruleId,
    path,
    line,
    severity,
    category,
    title,
    evidence,
  };
}

/**
 * Applies all mock rules to a set of parsed files (a full diff, or a
 * single chunk - the caller aggregates across chunks). Returns findings
 * sorted by path, then line, then ruleId, deduplicated by id.
 *
 * IMPORTANT: this function only ever reads AddedLine.content as inert
 * text for pattern matching. It never evaluates, executes, or branches
 * control flow based on diff content - this is what keeps MOCK-INJ
 * content (or any other injected instructions) inert.
 */
export function applyMockRules(files: ParsedFile[]): Finding[] {
  const seen = new Set<string>();
  const findings: Finding[] = [];

  for (const file of files) {
    for (const line of file.addedLines) {
      for (const rule of SIMPLE_RULES) {
        if (rule.test(line.content)) {
          const f = makeFinding(
            rule.id,
            rule.severity,
            rule.category,
            rule.title,
            file.path,
            line.line,
            line.content
          );
          if (!seen.has(f.id)) {
            seen.add(f.id);
            findings.push(f);
          }
        }
      }
    }

    for (const catchLine of findEmptyCatchBlocks(file.addedLines)) {
      const f = makeFinding(
        "MOCK-004",
        "high",
        "correctness",
        "swallowed exception",
        file.path,
        catchLine.line,
        catchLine.content
      );
      if (!seen.has(f.id)) {
        seen.add(f.id);
        findings.push(f);
      }
    }
  }

  findings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });

  return findings;
}
