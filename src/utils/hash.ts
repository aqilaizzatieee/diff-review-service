import crypto from "crypto";

function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(stableStringify).join(",") + "]";
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys.map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") +
    "}"
  );
}

export function hashBody(diff: string, options: unknown): string {
  const s = stableStringify({ diff, options });
  return crypto.createHash("sha256").update(s).digest("hex");
}
