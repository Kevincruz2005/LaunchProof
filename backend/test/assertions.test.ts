import { describe, expect, it } from "vitest";
import { compareChallenge, decimalEqual, evaluateAssertions } from "../src/assertions/engine.js";

describe("assertion engine", () => {
  it("uses decimal-safe equality", () => {
    expect(decimalEqual("42.10", 42.1)).toBe(true);
    expect(decimalEqual("42.101", 42.1)).toBe(false);
  });

  it("classifies missing fields separately from wrong values", () => {
    const comparisons = compareChallenge(
      { document_id: "LP-1", currency: "USD", total: "42.10", due_date: "2026-08-10" },
      { invoice_id: "LP-1", currency: "USD", total: "43.10", due_date: "2026-08-10" },
      ["document_id", "currency", "total", "due_date"],
    );
    expect(comparisons.find((item) => item.field === "document_id")?.classification).toBe("schema_drift");
    expect(comparisons.find((item) => item.field === "total")?.classification).toBe("invalid_output");
  });

  it("supports the four bounded assertion rules", () => {
    const comparisons = evaluateAssertions(
      { exact: "ok", high: 0.95, low: 3, code: "INV-101" },
      [
        { path: "$.exact", rule: "equals", value: "ok" },
        { path: "$.high", rule: "gte", value: 0.9 },
        { path: "$.low", rule: "lte", value: 4 },
        { path: "$.code", rule: "regex", value: "^INV-[0-9]+$" },
      ],
    );
    expect(comparisons.every((item) => item.match)).toBe(true);
  });
});
