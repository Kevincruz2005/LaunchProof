import { describe, expect, it } from "vitest";
import { gateBitmap, passportStatus } from "../src/domain/gates.js";

describe("passport gates", () => {
  it("produces verified only when the first four pass", () => {
    const gates = { discoverable: "pass", contract_correct: "pass", fresh_challenge: "pass", safe_to_rehearse: "pass", paid_delivery: "not_tested" } as const;
    expect(passportStatus(gates, true)).toBe("verified");
    expect(gateBitmap(gates)).toBe(85);
  });

  it("distinguishes tested failure from infrastructure incompleteness", () => {
    expect(passportStatus({ discoverable: "pass", contract_correct: "fail", fresh_challenge: "pass", safe_to_rehearse: "pass", paid_delivery: "pass" }, true)).toBe("needs-attention");
    expect(passportStatus({ discoverable: "not_tested", contract_correct: "not_tested", fresh_challenge: "not_tested", safe_to_rehearse: "pass", paid_delivery: "not_tested" }, false)).toBe("not-rehearsable");
  });
});
