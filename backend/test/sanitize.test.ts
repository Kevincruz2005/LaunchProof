import { describe, expect, it } from "vitest";
import { sanitizeEvidenceText, sanitizeEvidenceValue, sanitizeToolOutput } from "../src/evidence/sanitize.js";

describe("bounded canonical evidence", () => {
  it("redacts credential-shaped text before evidence persistence", () => {
    const sanitized = sanitizeEvidenceText(
      `Bearer abc.def api_key=supersecret private=${`0x${"ab".repeat(32)}`}`,
    );
    expect(sanitized).not.toContain("supersecret");
    expect(sanitized).not.toContain("ab".repeat(32));
    expect(sanitized).toContain("[redacted]");
  });

  it("caps nested objects and persists only declared output fields", () => {
    const large = Object.fromEntries(Array.from({ length: 50 }, (_, index) => [`field_${index}`, "x".repeat(1_000)]));
    const bounded = sanitizeEvidenceValue(large) as Record<string, unknown>;
    expect(Object.keys(bounded)).toHaveLength(20);
    expect(String(Object.values(bounded)[0])).toHaveLength(500);
    expect(sanitizeToolOutput({ declared: "ok", password: "leak" }, ["declared"])).toEqual({ declared: "ok" });
  });
});
