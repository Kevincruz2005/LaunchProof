import type { Gates, PassportStatus } from "./types.js";

const stateBits = { not_tested: 0, pass: 1, fail: 2 } as const;

export function gateBitmap(gates: Gates): number {
  return (
    stateBits[gates.discoverable] |
    (stateBits[gates.contract_correct] << 2) |
    (stateBits[gates.fresh_challenge] << 4) |
    (stateBits[gates.safe_to_rehearse] << 6) |
    (stateBits[gates.paid_delivery] << 8)
  );
}

export function passportStatus(gates: Gates, infrastructureComplete: boolean): PassportStatus {
  const firstFour = [
    gates.discoverable,
    gates.contract_correct,
    gates.fresh_challenge,
    gates.safe_to_rehearse,
  ];
  if (!infrastructureComplete || firstFour.includes("not_tested")) return "not-rehearsable";
  if (firstFour.every((gate) => gate === "pass") && gates.paid_delivery === "pass") return "verified";
  return "needs-attention";
}

export function contractStatus(status: PassportStatus): 0 | 1 | 2 {
  if (status === "verified") return 2;
  if (status === "needs-attention") return 1;
  return 0;
}
