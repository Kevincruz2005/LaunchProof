const MAX_STRING_LENGTH = 500;
const MAX_OBJECT_KEYS = 20;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 4;

const sensitiveKey = /authorization|cookie|pass(word|phrase)?|secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token/i;

export function sanitizeEvidenceValue(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return sanitizeEvidenceText(value);
  if (depth >= MAX_DEPTH) return "[depth-limited]";
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitizeEvidenceValue(item, depth + 1));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, MAX_OBJECT_KEYS);
    return Object.fromEntries(entries.map(([key, item]) => [
      key.slice(0, 80),
      sensitiveKey.test(key) ? "[redacted]" : sanitizeEvidenceValue(item, depth + 1),
    ]));
  }
  return String(value).slice(0, MAX_STRING_LENGTH);
}

export function sanitizeEvidenceText(input: string): string {
  return input
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(api[_-]?key|secret|password|passphrase|access[_-]?token|refresh[_-]?token)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-jwt]")
    .replace(/0x[0-9a-fA-F]{64}/g, "[redacted-32-byte-value]")
    .slice(0, MAX_STRING_LENGTH);
}

export function sanitizeToolOutput(
  output: Record<string, unknown> | null,
  allowedFields: readonly string[],
): Record<string, unknown> | null {
  if (!output) return null;
  return Object.fromEntries(
    [...new Set(allowedFields)]
      .filter((field) => Object.hasOwn(output, field))
      .map((field) => [field, sanitizeEvidenceValue(output[field])]),
  );
}

export function sanitizeStructuredError(
  error: { code: number | string; message: string } | null,
): { code: number | string; message: string } | null {
  if (!error) return null;
  return {
    code: typeof error.code === "string" ? error.code.slice(0, 80) : error.code,
    message: sanitizeEvidenceText(error.message),
  };
}
