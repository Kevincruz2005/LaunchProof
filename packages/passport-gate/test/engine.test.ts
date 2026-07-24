import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
  evaluatePassportGate,
  makeContractIdentity,
  type CurrentLaunchContractProof,
  type PassportGateConfig,
  type PassportGateEvaluationInput,
  type PassportProof,
  type SettlementProof,
} from "../src/index.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const ASSET = "0x4444444444444444444444444444444444444444";
const MANIFEST_HASH = `0x${"a".repeat(64)}` as const;
const SOURCE = "b".repeat(40);
const CONTRACT_URL = "https://provider.example.com/.well-known/launch-contract.json";
const OBSERVED_AT = "2026-01-02T00:00:00.000Z";

const config: PassportGateConfig = {
  chainId: 1952,
  network: "eip155:1952",
  assetAddress: ASSET,
  assetDecimals: 6,
  defaultWarnAgeHours: 24,
  defaultMaxAgeHours: 72,
  explorerBaseUrl: "https://explorer.example.com",
  passportBaseUrl: "https://launchproof.example.com",
  rehearsalBaseUrl: "https://launchproof.example.com",
};

function currentContract(overrides: Partial<CurrentLaunchContractProof> = {}): CurrentLaunchContractProof {
  return {
    launchContractUrl: CONTRACT_URL,
    manifestHash: MANIFEST_HASH,
    providerAddress: PROVIDER,
    sourceRevision: SOURCE,
    schemaValid: true,
    signatureValid: true,
    manifestHashValid: true,
    safeFetchVerified: true,
    ...overrides,
  };
}

function settlement(kind: "inbound" | "provider"): SettlementProof {
  const transactionHash = `0x${kind === "inbound" ? "c" : "d".repeat(1)}${"0".repeat(63)}` as const;
  const expected = {
    paymentId: `${kind}-payment`,
    network: "eip155:1952",
    asset: ASSET,
    amountAtomic: kind === "inbound" ? "10000" : "20000",
    assetDecimals: 6,
    payer: PAYER,
    recipient: kind === "inbound" ? RECIPIENT : PROVIDER,
    transactionHash,
    blockTimestamp: "2026-01-01T22:00:00.000Z",
  } as const;
  return {
    expected,
    reference: { ...expected },
    present: true,
    receiptSuccess: true,
    independentlyVerified: true,
  };
}

function passport(ageHours = 2): PassportProof {
  const anchored = new Date(Date.parse(OBSERVED_AT) - ageHours * 60 * 60 * 1_000).toISOString();
  return {
    runId: "run_01",
    status: "Verified",
    identity: makeContractIdentity(currentContract()),
    anchoredBlockTimestamp: anchored,
    gates: {
      discoverable: true,
      contract_correct: true,
      fresh_challenge: true,
      safe_to_rehearse: true,
      paid_delivery: true,
    },
    verification: {
      chainRecordFound: true,
      canonicalEvidenceMatch: true,
      evidenceHashMatch: true,
      manifestHashMatch: true,
      inputHashMatch: true,
      resultHashMatch: true,
      providerSignatureMatch: true,
      contractIdentityMatch: true,
      sourceRevisionMatch: true,
      registryRuntimeMatch: true,
      eventStorageMatch: true,
      publicationTransactionMatch: true,
      independentlyVerified: true,
    },
    databaseChainMatch: true,
    inboundSettlement: settlement("inbound"),
    providerSettlement: settlement("provider"),
    publicationTransactionHash: `0x${"e".repeat(64)}`,
    evidenceHash: `0x${"1".repeat(64)}`,
    manifestHash: MANIFEST_HASH,
    inputHash: `0x${"2".repeat(64)}`,
    resultHash: `0x${"3".repeat(64)}`,
  };
}

function evaluation(overrides: Partial<PassportGateEvaluationInput> = {}): PassportGateEvaluationInput {
  return {
    request: { launch_contract_url: CONTRACT_URL },
    config,
    observedAt: OBSERVED_AT,
    currentContract: currentContract(),
    newestRelevantPassport: passport(),
    ...overrides,
  };
}

function cloneEvaluation(): PassportGateEvaluationInput {
  return structuredClone(evaluation());
}

describe("PassportGate decisions", () => {
  it("returns ALLOW only for a fully verified and fresh Passport", () => {
    const result = evaluatePassportGate(evaluation());
    expect(result).toMatchObject({
      operational_status: "AVAILABLE",
      decision: "ALLOW",
      reason_codes: ["PASSPORT_VALID"],
      independent_verification: true,
      database_chain_match: true,
      passport_age_hours: 2,
      rehearsal_action: null,
    });
    if (result.operational_status === "AVAILABLE") {
      expect(result.explorer_links.publicationTransaction).toBe(
        `https://explorer.example.com/tx/0x${"e".repeat(64)}`,
      );
    }
  });

  it("returns WARN only for freshness approaching expiry", () => {
    const result = evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(48) });
    expect(result).toMatchObject({ decision: "WARN", reason_codes: ["PASSPORT_APPROACHING_EXPIRY"] });
  });

  it("requires a rehearsal when no exact Passport exists", () => {
    const result = evaluatePassportGate({ ...evaluation(), newestRelevantPassport: null });
    expect(result).toMatchObject({ decision: "REHEARSAL_REQUIRED", reason_codes: ["PASSPORT_NOT_FOUND"] });
    if (result.operational_status === "AVAILABLE") {
      expect(result.rehearsal_action).toMatchObject({
        kind: "REHEARSE",
        requiresExplicitPaymentApproval: true,
        automaticallyExecuted: false,
      });
    }
  });

  it("requires explicit renewal when the newest valid Passport is stale", () => {
    const result = evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(73) });
    expect(result).toMatchObject({ decision: "REHEARSAL_REQUIRED", reason_codes: ["PASSPORT_EXPIRED"] });
    if (result.operational_status === "AVAILABLE") {
      expect(result.rehearsal_action?.kind).toBe("RENEW");
      expect(result.rehearsal_action?.url).toContain("previous_run_id=run_01");
    }
  });

  it("uses exact inclusive freshness boundaries", () => {
    expect(evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(24) })).toMatchObject({ decision: "ALLOW" });
    expect(evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(24.0001) })).toMatchObject({ decision: "WARN" });
    expect(evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(72) })).toMatchObject({ decision: "WARN" });
    expect(evaluatePassportGate({ ...evaluation(), newestRelevantPassport: passport(72.0001) })).toMatchObject({ decision: "REHEARSAL_REQUIRED" });
  });

  it("obeys the decision truth table across fuzzed gate states and ages", () => {
    fc.assert(
      fc.property(
        fc.tuple(fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean(), fc.boolean()),
        fc.integer({ min: 0, max: 100 }),
        (gateValues, ageHours) => {
          const candidate = passport(ageHours);
          [
            candidate.gates.discoverable,
            candidate.gates.contract_correct,
            candidate.gates.fresh_challenge,
            candidate.gates.safe_to_rehearse,
            candidate.gates.paid_delivery,
          ] = gateValues;
          const result = evaluatePassportGate({ ...evaluation(), newestRelevantPassport: candidate });
          if (gateValues.some((value) => !value)) expect(result).toMatchObject({ decision: "BLOCK" });
          else if (ageHours <= 24) expect(result).toMatchObject({ decision: "ALLOW" });
          else if (ageHours <= 72) expect(result).toMatchObject({ decision: "WARN" });
          else expect(result).toMatchObject({ decision: "REHEARSAL_REQUIRED" });
        },
      ),
      { numRuns: 300 },
    );
  });

  it.each([
    ["discoverable", "GATE_DISCOVERABLE_FAILED"],
    ["contract_correct", "GATE_CONTRACT_CORRECT_FAILED"],
    ["fresh_challenge", "GATE_FRESH_CHALLENGE_FAILED"],
    ["safe_to_rehearse", "GATE_SAFE_TO_REHEARSE_FAILED"],
    ["paid_delivery", "GATE_PAID_DELIVERY_FAILED"],
  ] as const)("blocks when the %s gate fails", (gate, reason) => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.gates[gate] = false;
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining([reason]) });
  });

  it.each([
    ["chainRecordFound", "CHAIN_RECORD_MISSING"],
    ["canonicalEvidenceMatch", "CANONICAL_EVIDENCE_MISMATCH"],
    ["evidenceHashMatch", "EVIDENCE_HASH_MISMATCH"],
    ["manifestHashMatch", "MANIFEST_HASH_MISMATCH"],
    ["inputHashMatch", "INPUT_HASH_MISMATCH"],
    ["resultHashMatch", "RESULT_HASH_MISMATCH"],
    ["providerSignatureMatch", "PROVIDER_SIGNATURE_MISMATCH"],
    ["contractIdentityMatch", "PASSPORT_CONTRACT_IDENTITY_MISMATCH"],
    ["sourceRevisionMatch", "PASSPORT_SOURCE_REVISION_MISMATCH"],
    ["registryRuntimeMatch", "REGISTRY_RUNTIME_MISMATCH"],
    ["eventStorageMatch", "REGISTRY_EVENT_STORAGE_MISMATCH"],
    ["publicationTransactionMatch", "PUBLICATION_TRANSACTION_MISMATCH"],
    ["independentlyVerified", "INDEPENDENT_VERIFICATION_FAILED"],
  ] as const)("blocks when %s is false", (check, reason) => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.verification[check] = false;
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining([reason]) });
  });

  it.each(["NeedsAttention", "NotRehearsable"] as const)("blocks an authentic %s Passport", (status) => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.status = status;
    expect(evaluatePassportGate(input)).toMatchObject({
      decision: "BLOCK",
      reason_codes: expect.arrayContaining([status === "NeedsAttention" ? "PASSPORT_NEEDS_ATTENTION" : "PASSPORT_NOT_REHEARSABLE"]),
    });
  });

  it("blocks when database cache and chain reconstruction disagree", () => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.databaseChainMatch = false;
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining(["DATABASE_CHAIN_MISMATCH"]) });
  });

  it("never returns ALLOW from a database-only candidate", () => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.databaseChainMatch = true;
    input.newestRelevantPassport!.verification.chainRecordFound = false;
    input.newestRelevantPassport!.verification.independentlyVerified = false;
    const result = evaluatePassportGate(input);
    expect(result).toMatchObject({
      operational_status: "AVAILABLE",
      decision: "BLOCK",
      reason_codes: expect.arrayContaining(["CHAIN_RECORD_MISSING", "INDEPENDENT_VERIFICATION_FAILED"]),
    });
  });

  it("blocks malformed/future anchored chain timestamps", () => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.anchoredBlockTimestamp = "2027-01-01T00:00:00.000Z";
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining(["ANCHORED_TIMESTAMP_INVALID"]) });
  });

  it("blocks an expected provider mismatch", () => {
    const input = evaluation({ request: { launch_contract_url: CONTRACT_URL, expected_provider_address: RECIPIENT } });
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: ["EXPECTED_PROVIDER_MISMATCH"] });
  });

  it("blocks an expected source revision mismatch", () => {
    const input = evaluation({ request: { launch_contract_url: CONTRACT_URL, expected_source_revision: "f".repeat(40) } });
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: ["EXPECTED_SOURCE_REVISION_MISMATCH"] });
  });

  it("requires a rehearsal when the contract identity changes", () => {
    const changed = currentContract({ manifestHash: `0x${"f".repeat(64)}` });
    const result = evaluatePassportGate(evaluation({ currentContract: changed }));
    expect(result).toMatchObject({ decision: "REHEARSAL_REQUIRED", reason_codes: ["CONTRACT_IDENTITY_CHANGED"] });
  });

  it("requires a rehearsal when the source revision changes", () => {
    const changed = currentContract({ sourceRevision: "f".repeat(40) });
    const result = evaluatePassportGate(evaluation({ currentContract: changed }));
    expect(result).toMatchObject({ decision: "REHEARSAL_REQUIRED", reason_codes: ["SOURCE_REVISION_CHANGED"] });
  });

  it("blocks a Passport whose identity hash does not match its identity fields", () => {
    const input = cloneEvaluation();
    input.newestRelevantPassport!.identity.identityHash = `0x${"9".repeat(64)}`;
    expect(evaluatePassportGate(input)).toMatchObject({
      decision: "BLOCK",
      reason_codes: ["PASSPORT_CONTRACT_IDENTITY_MISMATCH"],
    });
  });

  it.each([
    ["schemaValid", "LAUNCH_CONTRACT_INVALID"],
    ["signatureValid", "LAUNCH_CONTRACT_SIGNATURE_INVALID"],
    ["manifestHashValid", "LAUNCH_CONTRACT_HASH_MISMATCH"],
    ["safeFetchVerified", "LAUNCH_CONTRACT_UNSAFE_URL"],
  ] as const)("blocks an invalid current-contract %s proof", (field, reason) => {
    const result = evaluatePassportGate(evaluation({ currentContract: currentContract({ [field]: false }) }));
    expect(result).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining([reason]) });
  });

  it.each(["RPC_UNAVAILABLE", "RPC_TIMEOUT", "RPC_RATE_LIMITED", "INDEX_UNAVAILABLE"] as const)(
    "returns operational unavailability, not a trust decision, for %s",
    (code) => {
      const result = evaluatePassportGate(evaluation({ operationalFailure: { code, explanation: "Temporary dependency failure." } }));
      expect(result).toEqual({
        operational_status: "UNAVAILABLE",
        decision: null,
        reason_codes: [code],
        explanation: "Temporary dependency failure.",
        observed_at: OBSERVED_AT,
      });
    },
  );

  it("returns operational unavailability when no current contract proof is available", () => {
    const input = evaluation();
    delete input.currentContract;
    expect(evaluatePassportGate(input)).toMatchObject({
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["CONTRACT_FETCH_UNAVAILABLE"],
    });
  });

  it("rejects invalid request thresholds, provider addresses, and source SHAs", () => {
    expect(() => evaluatePassportGate(evaluation({ request: { launch_contract_url: CONTRACT_URL, warn_age_hours: -1 } }))).toThrow();
    expect(() => evaluatePassportGate(evaluation({ request: { launch_contract_url: CONTRACT_URL, warn_age_hours: 72, max_age_hours: 72 } }))).toThrow();
    expect(() => evaluatePassportGate(evaluation({ request: { launch_contract_url: CONTRACT_URL, expected_provider_address: "0x123" } }))).toThrow();
    expect(() => evaluatePassportGate(evaluation({ request: { launch_contract_url: CONTRACT_URL, expected_source_revision: "short" } }))).toThrow();
  });

  it("rejects any non-X-Layer-testnet configuration", () => {
    expect(() => evaluatePassportGate(evaluation({ config: { ...config, chainId: 1 as 1952 } }))).toThrow(
      "PassportGate is restricted to X Layer testnet",
    );
  });

  it("rejects the zero address wherever an EVM identity is required", () => {
    expect(() => evaluatePassportGate(evaluation({
      request: { launch_contract_url: CONTRACT_URL, expected_provider_address: `0x${"0".repeat(40)}` },
    }))).toThrow();
  });
});

describe.each(["inboundSettlement", "providerSettlement"] as const)("%s verification", (role) => {
  const prefix = role === "inboundSettlement" ? "INBOUND" : "PROVIDER";
  const cases: Array<[string, string, (proof: SettlementProof) => void]> = [
    ["missing", `${prefix}_SETTLEMENT_MISSING`, (proof) => { proof.present = false; proof.reference = null; }],
    ["reverted", `${prefix}_SETTLEMENT_REVERTED`, (proof) => { proof.receiptSuccess = false; }],
    ["wrong network", `${prefix}_SETTLEMENT_NETWORK_MISMATCH`, (proof) => { proof.reference!.network = "eip155:1"; }],
    ["wrong asset", `${prefix}_SETTLEMENT_ASSET_MISMATCH`, (proof) => { proof.reference!.asset = RECIPIENT; }],
    ["wrong amount", `${prefix}_SETTLEMENT_AMOUNT_MISMATCH`, (proof) => { proof.reference!.amountAtomic = "999"; }],
    ["wrong decimals", `${prefix}_SETTLEMENT_DECIMALS_MISMATCH`, (proof) => { proof.reference!.assetDecimals = 18; }],
    ["wrong payer", `${prefix}_SETTLEMENT_PAYER_MISMATCH`, (proof) => { proof.reference!.payer = PROVIDER; }],
    ["wrong recipient", `${prefix}_SETTLEMENT_RECIPIENT_MISMATCH`, (proof) => { proof.reference!.recipient = PAYER; }],
    ["wrong transaction", `${prefix}_SETTLEMENT_TRANSACTION_MISMATCH`, (proof) => { proof.reference!.transactionHash = `0x${"9".repeat(64)}`; }],
    ["wrong payment identity", `${prefix}_SETTLEMENT_TRANSACTION_MISMATCH`, (proof) => { proof.reference!.paymentId = "different-payment"; }],
    ["wrong timestamp", `${prefix}_SETTLEMENT_TIMESTAMP_MISMATCH`, (proof) => { proof.reference!.blockTimestamp = "2026-01-01T21:00:00.000Z"; }],
    ["not independently verified", `${prefix}_SETTLEMENT_NOT_INDEPENDENTLY_VERIFIED`, (proof) => { proof.independentlyVerified = false; }],
    ["expected and observed wrong network", `${prefix}_SETTLEMENT_NETWORK_MISMATCH`, (proof) => { proof.expected.network = "eip155:1"; proof.reference!.network = "eip155:1"; }],
    ["expected and observed wrong asset", `${prefix}_SETTLEMENT_ASSET_MISMATCH`, (proof) => { proof.expected.asset = RECIPIENT; proof.reference!.asset = RECIPIENT; }],
    ["expected and observed wrong decimals", `${prefix}_SETTLEMENT_DECIMALS_MISMATCH`, (proof) => { proof.expected.assetDecimals = 18; proof.reference!.assetDecimals = 18; }],
  ];

  it.each(cases)("blocks a %s", (_label, reason, mutate) => {
    const input = cloneEvaluation();
    mutate(input.newestRelevantPassport![role]);
    expect(evaluatePassportGate(input)).toMatchObject({ decision: "BLOCK", reason_codes: expect.arrayContaining([reason]) });
  });
});
