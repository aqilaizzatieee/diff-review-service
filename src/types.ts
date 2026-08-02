export type Severity = "critical" | "high" | "medium" | "low";
export type Category = "security" | "correctness" | "performance" | "style";

export interface Finding {
  id: string;
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  category: Category;
  title: string;
  evidence: string;
}

export interface Usage {
  inputBytes: number;
  chunks: number;
  cacheHit: boolean;
}

export type JobStatus = "queued" | "running" | "done" | "failed";

export interface ReviewOptions {
  provider: "mock" | "llm";
  maxFindings: number;
}

export interface AddedLine {
  path: string;
  line: number; // line number in the NEW file
  content: string; // line content WITHOUT the leading '+'
}

export interface ParsedFile {
  path: string;
  raw: string; // the original diff text belonging to this file (for chunking)
  bytes: number;
  addedLines: AddedLine[];
}

export interface JobEvent {
  event: "status" | "finding" | "done";
  data: any;
}

export interface Job {
  id: string;
  status: JobStatus;
  diff: string;
  options: ReviewOptions;
  bodyHash: string;
  files?: ParsedFile[];
  findings: Finding[];
  usage: Usage;
  error?: { code: string; message: string };
  events: JobEvent[];
  subscribers: Set<(evt: JobEvent) => void>;
  createdAt: number;
}

export class AppError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number, message: string) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
