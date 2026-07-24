import { PassportGateValidationError } from "./errors.js";
import {
  makeContractIdentity,
  normalizeAddress,
  normalizeBytes32,
  normalizePublicHttpsUrl,
  normalizeSourceRevision,
} from "./primitives.js";
import {
  gateNames,
  type ContractIdentity,
  type CurrentLaunchContractProof,
  type ExplorerLinks,
  type GateName,
  type PassportGateConfig,
  type PassportGateDecisionResult,
  type PassportGateEvaluationInput,
  type PassportGateEvidenceView,
  type PassportGateResult,
  type PassportProof,
  type ReasonCode,
  type RehearsalAction,
  type SettlementProof,
} from "./types.js";
import {
  parseObservedAt,
  validatePassportGateConfig,
  validatePassportGateRequest,
} from "./validation.js";

const HOUR_MS = 60 * 60 * 1_000;

const gateFailureCodes: Record<GateName, ReasonCode> = {
  discoverable: "GATE_DISCOVERABLE_FAILED",
  contract_correct: "GATE_CONTRACT_CORRECT_FAILED",
  fresh_challenge: "GATE_FRESH_CHALLENGE_FAILED",
  safe_to_rehearse: "GATE_SAFE_TO_REHEARSE_FAILED",
  paid_delivery: "GATE_PAID_DELIVERY_FAILED",
};

const verificationFailureCodes = {
  chainRecordFound: "CHAIN_RECORD_MISSING",
  canonicalEvidenceMatch: "CANONICAL_EVIDENCE_MISMATCH",
  evidenceHashMatch: "EVIDENCE_HASH_MISMATCH",
  manifestHashMatch: "MANIFEST_HASH_MISMATCH",
  inputHashMatch: "INPUT_HASH_MISMATCH",
  resultHashMatch: "RESULT_HASH_MISMATCH",
  providerSignatureMatch: "PROVIDER_SIGNATURE_MISMATCH",
  contractIdentityMatch: "PASSPORT_CONTRACT_IDENTITY_MISMATCH",
  sourceRevisionMatch: "PASSPORT_SOURCE_REVISION_MISMATCH",
  registryRuntimeMatch: "REGISTRY_RUNTIME_MISMATCH",
  eventStorageMatch: "REGISTRY_EVENT_STORAGE_MISMATCH",
  publicationTransactionMatch: "PUBLICATION_TRANSACTION_MISMATCH",
  independentlyVerified: "INDEPENDENT_VERIFICATION_FAILED",
} as const satisfies Record<keyof PassportProof["verification"], ReasonCode>;

function transactionUrl(base: string, hash: string | null): string | null {
  return hash ? `${base}/tx/${encodeURIComponent(hash)}` : null;
}

function passportUrl(base: string, runId: string | null): string | null {
  return runId ? `${base}/passport/${encodeURIComponent(runId)}` : null;
}

function actionUrl(
  config: PassportGateConfig,
  launchContractUrl: string,
  kind: "REHEARSE" | "RENEW",
  previousRunId?: string,
): RehearsalAction {
  const url = new URL("/rehearse", `${config.rehearsalBaseUrl}/`);
  url.searchParams.set("launch_contract_url", launchContractUrl);
  if (kind === "RENEW" && previousRunId) url.searchParams.set("previous_run_id", previousRunId);
  return {
    kind,
    url: url.toString(),
    requiresExplicitPaymentApproval: true,
    automaticallyExecuted: false,
  };
}

function sameBaseIdentity(left: ContractIdentity, right: ContractIdentity): boolean {
  return (
    left.launchContractUrl === right.launchContractUrl &&
    left.manifestHash === right.manifestHash &&
    left.providerAddress === right.providerAddress
  );
}

function safeCurrentIdentity(
  proof: CurrentLaunchContractProof,
  requestedUrl: string,
): { identity: ContractIdentity | null; failures: ReasonCode[] } {
  const failures: ReasonCode[] = [];
  let identity: ContractIdentity | null = null;
  try {
    identity = makeContractIdentity(proof);
    if (identity.launchContractUrl !== requestedUrl) failures.push("LAUNCH_CONTRACT_INVALID");
  } catch (error) {
    failures.push(
      error instanceof PassportGateValidationError && error.code === "UNSAFE_LAUNCH_CONTRACT_URL"
        ? "LAUNCH_CONTRACT_UNSAFE_URL"
        : "LAUNCH_CONTRACT_INVALID",
    );
  }
  if (!proof.schemaValid) failures.push("LAUNCH_CONTRACT_INVALID");
  if (!proof.signatureValid) failures.push("LAUNCH_CONTRACT_SIGNATURE_INVALID");
  if (!proof.manifestHashValid) failures.push("LAUNCH_CONTRACT_HASH_MISMATCH");
  if (!proof.safeFetchVerified) failures.push("LAUNCH_CONTRACT_UNSAFE_URL");
  return { identity, failures: [...new Set(failures)] };
}

function settlementFailures(
  role: "INBOUND" | "PROVIDER",
  proof: SettlementProof,
  config: PassportGateConfig,
): ReasonCode[] {
  const code = (suffix: string): ReasonCode => `${role}_SETTLEMENT_${suffix}` as ReasonCode;
  if (!proof.present || proof.reference === null) return [code("MISSING")];

  const expected = proof.expected;
  const actual = proof.reference;
  const failures: ReasonCode[] = [];
  const addressesMatch = (left: string, right: string): boolean => {
    try {
      return normalizeAddress(left) === normalizeAddress(right);
    } catch {
      return false;
    }
  };
  const hashesMatch = (left: string, right: string): boolean => {
    try {
      return normalizeBytes32(left) === normalizeBytes32(right);
    } catch {
      return false;
    }
  };
  if (!proof.receiptSuccess) failures.push(code("REVERTED"));
  if (expected.network !== config.network || actual.network !== expected.network) failures.push(code("NETWORK_MISMATCH"));
  if (
    !addressesMatch(expected.asset, config.assetAddress) ||
    !addressesMatch(actual.asset, expected.asset)
  ) failures.push(code("ASSET_MISMATCH"));
  if (!/^\d+$/.test(expected.amountAtomic) || actual.amountAtomic !== expected.amountAtomic) {
    failures.push(code("AMOUNT_MISMATCH"));
  }
  if (expected.assetDecimals !== config.assetDecimals || actual.assetDecimals !== expected.assetDecimals) {
    failures.push(code("DECIMALS_MISMATCH"));
  }
  if (!expected.payer || !addressesMatch(actual.payer, expected.payer)) failures.push(code("PAYER_MISMATCH"));
  if (!addressesMatch(actual.recipient, expected.recipient)) {
    failures.push(code("RECIPIENT_MISMATCH"));
  }
  if (
    !expected.paymentId ||
    actual.paymentId !== expected.paymentId ||
    !expected.transactionHash ||
    !hashesMatch(actual.transactionHash, expected.transactionHash)
  ) failures.push(code("TRANSACTION_MISMATCH"));
  if (!expected.blockTimestamp || !Number.isFinite(Date.parse(expected.blockTimestamp)) || actual.blockTimestamp !== expected.blockTimestamp) {
    failures.push(code("TIMESTAMP_MISMATCH"));
  }
  if (!proof.independentlyVerified) failures.push(code("NOT_INDEPENDENTLY_VERIFIED"));
  return [...new Set(failures)];
}

function explorerLinks(config: PassportGateConfig, passport: PassportProof | null): ExplorerLinks {
  return {
    publicationTransaction: transactionUrl(config.explorerBaseUrl, passport?.publicationTransactionHash ?? null),
    inboundSettlement: transactionUrl(
      config.explorerBaseUrl,
      passport?.inboundSettlement.reference?.transactionHash ?? null,
    ),
    providerSettlement: transactionUrl(
      config.explorerBaseUrl,
      passport?.providerSettlement.reference?.transactionHash ?? null,
    ),
  };
}

function evidenceView(input: {
  config: PassportGateConfig;
  observedAt: string;
  warnAgeHours: number;
  maxAgeHours: number;
  identity: ContractIdentity | null;
  passport: PassportProof | null;
  ageHours: number | null;
  expiry: string | null;
  action: RehearsalAction | null;
}): PassportGateEvidenceView {
  const { config, passport } = input;
  return {
    observed_at: input.observedAt,
    passport_age_hours: input.ageHours,
    warn_age_hours: input.warnAgeHours,
    max_age_hours: input.maxAgeHours,
    expires_at: input.expiry,
    contract_identity: input.identity,
    provider_address: input.identity?.providerAddress ?? null,
    source_revision: input.identity?.sourceRevision ?? null,
    run_id: passport?.runId ?? null,
    passport_url: passportUrl(config.passportBaseUrl, passport?.runId ?? null),
    status: passport?.status ?? null,
    gates: passport?.gates ?? null,
    independent_verification: passport?.verification.independentlyVerified ?? false,
    database_chain_match: passport?.databaseChainMatch ?? null,
    inbound_settlement: passport?.inboundSettlement.reference ?? null,
    provider_settlement: passport?.providerSettlement.reference ?? null,
    evidence_publication_transaction: passport?.publicationTransactionHash ?? null,
    explorer_links: explorerLinks(config, passport),
    evidence_hash: passport?.evidenceHash ?? null,
    manifest_hash: passport?.manifestHash ?? input.identity?.manifestHash ?? null,
    input_hash: passport?.inputHash ?? null,
    result_hash: passport?.resultHash ?? null,
    rehearsal_action: input.action,
  };
}

function decision(
  view: PassportGateEvidenceView,
  value: PassportGateDecisionResult["decision"],
  reasons: ReasonCode[],
  explanation: string,
): PassportGateDecisionResult {
  return {
    operational_status: "AVAILABLE",
    decision: value,
    reason_codes: reasons,
    explanation,
    ...view,
  };
}

export function evaluatePassportGate(input: PassportGateEvaluationInput): PassportGateResult {
  const config = validatePassportGateConfig(input.config);
  const request = validatePassportGateRequest(input.request, config);
  const observedAtMs = parseObservedAt(input.observedAt);
  const observedAt = new Date(observedAtMs).toISOString();

  if (input.operationalFailure) {
    return {
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: [input.operationalFailure.code],
      explanation: input.operationalFailure.explanation,
      observed_at: observedAt,
    };
  }
  if (!input.currentContract) {
    return {
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["CONTRACT_FETCH_UNAVAILABLE"],
      explanation: "The current signed Launch Contract could not be obtained.",
      observed_at: observedAt,
    };
  }

  const current = safeCurrentIdentity(input.currentContract, request.launchContractUrl);
  const passport = input.newestRelevantPassport ?? null;
  const baseView = (action: RehearsalAction | null, ageHours: number | null = null, expiry: string | null = null) =>
    evidenceView({
      config,
      observedAt,
      warnAgeHours: request.warnAgeHours,
      maxAgeHours: request.maxAgeHours,
      identity: current.identity,
      passport,
      ageHours,
      expiry,
      action,
    });

  if (current.failures.length > 0 || !current.identity) {
    return decision(baseView(null), "BLOCK", current.failures, "The current Launch Contract failed authenticity or safety checks.");
  }
  if (
    request.expectedProviderAddress !== null &&
    request.expectedProviderAddress !== current.identity.providerAddress
  ) {
    return decision(baseView(null), "BLOCK", ["EXPECTED_PROVIDER_MISMATCH"], "The provider does not match the caller's expectation.");
  }
  if (
    request.expectedSourceRevision !== null &&
    request.expectedSourceRevision !== current.identity.sourceRevision
  ) {
    return decision(baseView(null), "BLOCK", ["EXPECTED_SOURCE_REVISION_MISMATCH"], "The source revision does not match the caller's expectation.");
  }
  if (!passport) {
    return decision(
      baseView(actionUrl(config, request.launchContractUrl, "REHEARSE")),
      "REHEARSAL_REQUIRED",
      ["PASSPORT_NOT_FOUND"],
      "No Passport exists for the exact current Launch Contract identity.",
    );
  }

  let normalizedPassportIdentity: ContractIdentity;
  try {
    normalizedPassportIdentity = makeContractIdentity(passport.identity);
  } catch {
    return decision(
      baseView(null),
      "BLOCK",
      ["PASSPORT_CONTRACT_IDENTITY_MISMATCH"],
      "The Passport contains an invalid contract identity.",
    );
  }
  if (normalizedPassportIdentity.identityHash !== passport.identity.identityHash) {
    return decision(
      baseView(null),
      "BLOCK",
      ["PASSPORT_CONTRACT_IDENTITY_MISMATCH"],
      "The Passport contract identity hash does not match its identity fields.",
    );
  }

  if (!sameBaseIdentity(current.identity, normalizedPassportIdentity)) {
    return decision(
      baseView(actionUrl(config, request.launchContractUrl, "REHEARSE")),
      "REHEARSAL_REQUIRED",
      ["CONTRACT_IDENTITY_CHANGED"],
      "The Launch Contract identity changed after the available Passport was issued.",
    );
  }
  if (current.identity.sourceRevision !== normalizedPassportIdentity.sourceRevision) {
    return decision(
      baseView(actionUrl(config, request.launchContractUrl, "REHEARSE")),
      "REHEARSAL_REQUIRED",
      ["SOURCE_REVISION_CHANGED"],
      "The provider published a new source revision after the available Passport was issued.",
    );
  }

  const failures: ReasonCode[] = [];
  for (const [check, reason] of Object.entries(verificationFailureCodes) as [keyof PassportProof["verification"], ReasonCode][]) {
    if (!passport.verification[check]) failures.push(reason);
  }
  if (!passport.databaseChainMatch) failures.push("DATABASE_CHAIN_MISMATCH");
  if (passport.identity.identityHash !== current.identity.identityHash) failures.push("PASSPORT_CONTRACT_IDENTITY_MISMATCH");
  const checkedHashes: Array<[string, ReasonCode]> = [
    [passport.publicationTransactionHash, "PUBLICATION_TRANSACTION_MISMATCH"],
    [passport.evidenceHash, "EVIDENCE_HASH_MISMATCH"],
    [passport.manifestHash, "MANIFEST_HASH_MISMATCH"],
    [passport.inputHash, "INPUT_HASH_MISMATCH"],
    [passport.resultHash, "RESULT_HASH_MISMATCH"],
  ];
  for (const [hash, reason] of checkedHashes) {
    try {
      normalizeBytes32(hash);
    } catch {
      failures.push(reason);
    }
  }
  if (passport.manifestHash.toLowerCase() !== current.identity.manifestHash) failures.push("MANIFEST_HASH_MISMATCH");
  if (passport.status === "NeedsAttention") failures.push("PASSPORT_NEEDS_ATTENTION");
  if (passport.status === "NotRehearsable") failures.push("PASSPORT_NOT_REHEARSABLE");
  for (const gate of gateNames) if (!passport.gates[gate]) failures.push(gateFailureCodes[gate]);
  failures.push(...settlementFailures("INBOUND", passport.inboundSettlement, config));
  failures.push(...settlementFailures("PROVIDER", passport.providerSettlement, config));

  const anchoredAtMs = Date.parse(passport.anchoredBlockTimestamp);
  let ageHours: number | null = null;
  let expiry: string | null = null;
  if (!Number.isFinite(anchoredAtMs) || anchoredAtMs > observedAtMs) {
    failures.push("ANCHORED_TIMESTAMP_INVALID");
  } else {
    ageHours = (observedAtMs - anchoredAtMs) / HOUR_MS;
    expiry = new Date(anchoredAtMs + request.maxAgeHours * HOUR_MS).toISOString();
  }

  if (failures.length > 0) {
    return decision(
      baseView(null, ageHours, expiry),
      "BLOCK",
      [...new Set(failures)],
      "The Passport failed one or more independent trust checks.",
    );
  }

  if (ageHours === null) throw new Error("Invariant: a verified Passport must have a valid anchored timestamp.");
  if (ageHours > request.maxAgeHours) {
    return decision(
      baseView(actionUrl(config, request.launchContractUrl, "RENEW", passport.runId), ageHours, expiry),
      "REHEARSAL_REQUIRED",
      ["PASSPORT_EXPIRED"],
      "The latest valid Passport is older than the maximum accepted age.",
    );
  }
  if (ageHours > request.warnAgeHours) {
    return decision(
      baseView(null, ageHours, expiry),
      "WARN",
      ["PASSPORT_APPROACHING_EXPIRY"],
      "The Passport is valid but approaching its freshness expiry.",
    );
  }
  return decision(baseView(null, ageHours, expiry), "ALLOW", ["PASSPORT_VALID"], "The current service Passport is independently verified and fresh.");
}
