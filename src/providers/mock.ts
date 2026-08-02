import { Finding, ParsedFile } from "../types";
import { applyMockRules } from "../rules/mockRules";

export async function runMockProvider(files: ParsedFile[]): Promise<Finding[]> {
  // Synchronous and deterministic - wrapped in a resolved promise so it
  // shares an async interface with the llm provider.
  return applyMockRules(files);
}
