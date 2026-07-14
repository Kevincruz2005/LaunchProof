import type { LaunchContract } from "../launch-contract/schema.js";
import type { FailureClassification, FieldComparison } from "../domain/types.js";

function fieldAt(value: Record<string, unknown>, path: string): unknown {
  return value[path.slice(2)];
}

function decimalCents(value: unknown): bigint | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value);
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  return negative ? -cents : cents;
}

export function decimalEqual(left: unknown, right: unknown): boolean {
  const a = decimalCents(left);
  const b = decimalCents(right);
  return a !== null && b !== null && a === b;
}

export function evaluateAssertions(
  output: Record<string, unknown>,
  assertions: LaunchContract["assertions"],
): FieldComparison[] {
  return assertions.map((assertion) => {
    const actual = fieldAt(output, assertion.path);
    let match = false;
    if (assertion.rule === "equals") {
      match = typeof assertion.value === "number" ? decimalEqual(actual, assertion.value) : Object.is(actual, assertion.value);
    } else if (assertion.rule === "gte") {
      match = typeof actual === "number" && typeof assertion.value === "number" && actual >= assertion.value;
    } else if (assertion.rule === "lte") {
      match = typeof actual === "number" && typeof assertion.value === "number" && actual <= assertion.value;
    } else if (typeof actual === "string" && typeof assertion.value === "string") {
      match = new RegExp(assertion.value, assertion.flags).test(actual.slice(0, 5_000));
    }
    return {
      field: assertion.path.slice(2),
      expected: assertion.value,
      actual: actual ?? null,
      match,
      classification: match ? null : actual === undefined ? "schema_drift" : "invalid_output",
    };
  });
}

export function compareChallenge(
  expected: Record<string, unknown>,
  output: Record<string, unknown>,
  fields: string[],
): FieldComparison[] {
  return fields.map((field) => {
    const expectedValue = expected[field];
    const actual = output[field];
    const missing = actual === undefined;
    const wrongType = !missing && typeof actual !== typeof expectedValue && !(field === "total" && decimalCents(actual) !== null);
    const match = field === "total" ? decimalEqual(expectedValue, actual) : Object.is(expectedValue, actual);
    let classification: FailureClassification = null;
    if (!match) classification = missing || wrongType ? "schema_drift" : "invalid_output";
    return { field, expected: expectedValue, actual: actual ?? null, match, classification };
  });
}

export function overallClassification(comparisons: FieldComparison[]): FailureClassification {
  if (comparisons.some((comparison) => comparison.classification === "schema_drift")) return "schema_drift";
  if (comparisons.some((comparison) => comparison.classification === "invalid_output")) return "invalid_output";
  return null;
}
