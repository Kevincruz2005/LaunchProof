export const XLAYER_TESTNET_CHAIN_ID = 1952 as const;
export const XLAYER_TESTNET_NETWORK = "eip155:1952" as const;

export const gateNames = [
  "discoverable",
  "contract_correct",
  "fresh_challenge",
  "safe_to_rehearse",
  "paid_delivery",
] as const;

export type GateName = (typeof gateNames)[number];
export type GateResults = Record<GateName, boolean>;
export type Hex = `0x${string}`;
export type Address = `0x${string}`;
export type PassportDecision = "ALLOW" | "WARN" | "BLOCK" | "REHEARSAL_REQUIRED";
export type PassportStatus = "Verified" | "NeedsAttention" | "NotRehearsable";
export type RehearsalActionKind = "REHEARSE" | "RENEW";

export type ReasonCode =
  | "PASSPORT_VALID"
  | "PASSPORT_APPROACHING_EXPIRY"
  | "PASSPORT_NOT_FOUND"
  | "PASSPORT_EXPIRED"
  | "CONTRACT_IDENTITY_CHANGED"
  | "SOURCE_REVISION_CHANGED"
  | "EXPECTED_PROVIDER_MISMATCH"
  | "EXPECTED_SOURCE_REVISION_MISMATCH"
  | "LAUNCH_CONTRACT_INVALID"
  | "LAUNCH_CONTRACT_SIGNATURE_INVALID"
  | "LAUNCH_CONTRACT_HASH_MISMATCH"
  | "LAUNCH_CONTRACT_UNSAFE_URL"
  | "PASSPORT_NEEDS_ATTENTION"
  | "PASSPORT_NOT_REHEARSABLE"
  | "GATE_DISCOVERABLE_FAILED"
  | "GATE_CONTRACT_CORRECT_FAILED"
  | "GATE_FRESH_CHALLENGE_FAILED"
  | "GATE_SAFE_TO_REHEARSE_FAILED"
  | "GATE_PAID_DELIVERY_FAILED"
  | "CHAIN_RECORD_MISSING"
  | "CANONICAL_EVIDENCE_MISMATCH"
  | "EVIDENCE_HASH_MISMATCH"
  | "MANIFEST_HASH_MISMATCH"
  | "INPUT_HASH_MISMATCH"
  | "RESULT_HASH_MISMATCH"
  | "PROVIDER_SIGNATURE_MISMATCH"
  | "PASSPORT_CONTRACT_IDENTITY_MISMATCH"
  | "PASSPORT_SOURCE_REVISION_MISMATCH"
  | "REGISTRY_RUNTIME_MISMATCH"
  | "REGISTRY_EVENT_STORAGE_MISMATCH"
  | "PUBLICATION_TRANSACTION_MISMATCH"
  | "INDEPENDENT_VERIFICATION_FAILED"
  | "DATABASE_CHAIN_MISMATCH"
  | "ANCHORED_TIMESTAMP_INVALID"
  | "INBOUND_SETTLEMENT_MISSING"
  | "INBOUND_SETTLEMENT_REVERTED"
  | "INBOUND_SETTLEMENT_NETWORK_MISMATCH"
  | "INBOUND_SETTLEMENT_ASSET_MISMATCH"
  | "INBOUND_SETTLEMENT_AMOUNT_MISMATCH"
  | "INBOUND_SETTLEMENT_DECIMALS_MISMATCH"
  | "INBOUND_SETTLEMENT_PAYER_MISMATCH"
  | "INBOUND_SETTLEMENT_RECIPIENT_MISMATCH"
  | "INBOUND_SETTLEMENT_TRANSACTION_MISMATCH"
  | "INBOUND_SETTLEMENT_TIMESTAMP_MISMATCH"
  | "INBOUND_SETTLEMENT_NOT_INDEPENDENTLY_VERIFIED"
  | "PROVIDER_SETTLEMENT_MISSING"
  | "PROVIDER_SETTLEMENT_REVERTED"
  | "PROVIDER_SETTLEMENT_NETWORK_MISMATCH"
  | "PROVIDER_SETTLEMENT_ASSET_MISMATCH"
  | "PROVIDER_SETTLEMENT_AMOUNT_MISMATCH"
  | "PROVIDER_SETTLEMENT_DECIMALS_MISMATCH"
  | "PROVIDER_SETTLEMENT_PAYER_MISMATCH"
  | "PROVIDER_SETTLEMENT_RECIPIENT_MISMATCH"
  | "PROVIDER_SETTLEMENT_TRANSACTION_MISMATCH"
  | "PROVIDER_SETTLEMENT_TIMESTAMP_MISMATCH"
  | "PROVIDER_SETTLEMENT_NOT_INDEPENDENTLY_VERIFIED";

export type OperationalReasonCode =
  | "RPC_UNAVAILABLE"
  | "RPC_TIMEOUT"
  | "RPC_RATE_LIMITED"
  | "INDEX_UNAVAILABLE"
  | "CONTRACT_FETCH_UNAVAILABLE"
  | "INTERNAL_UNAVAILABLE";

export interface PassportGateConfig {
  chainId: typeof XLAYER_TESTNET_CHAIN_ID;
  network: typeof XLAYER_TESTNET_NETWORK;
  assetAddress: Address;
  assetDecimals: number;
  defaultWarnAgeHours: number;
  defaultMaxAgeHours: number;
  explorerBaseUrl: string;
  passportBaseUrl: string;
  rehearsalBaseUrl: string;
  /** Public is the default. Local permits only loopback HTTP output links for isolated development. */
  deploymentMode?: "public" | "local";
}

export interface PassportGateRequest {
  launch_contract_url: string;
  warn_age_hours?: number;
  max_age_hours?: number;
  expected_provider_address?: Address;
  expected_source_revision?: string;
}

export interface ValidatedPassportGateRequest {
  launchContractUrl: string;
  warnAgeHours: number;
  maxAgeHours: number;
  expectedProviderAddress: Address | null;
  expectedSourceRevision: string | null;
}

export interface ContractIdentity {
  launchContractUrl: string;
  manifestHash: Hex;
  providerAddress: Address;
  sourceRevision: string;
  identityHash: Hex;
}

/**
 * Proof produced by the signed-contract fetch boundary. DNS resolution and
 * redirect checks belong at that boundary; `safeFetchVerified` prevents the
 * pure decision engine from treating an unchecked fetch as trusted input.
 */
export interface CurrentLaunchContractProof {
  launchContractUrl: string;
  manifestHash: Hex;
  providerAddress: Address;
  sourceRevision: string;
  schemaValid: boolean;
  signatureValid: boolean;
  manifestHashValid: boolean;
  safeFetchVerified: boolean;
}

export interface VerificationChecks {
  chainRecordFound: boolean;
  canonicalEvidenceMatch: boolean;
  evidenceHashMatch: boolean;
  manifestHashMatch: boolean;
  inputHashMatch: boolean;
  resultHashMatch: boolean;
  providerSignatureMatch: boolean;
  contractIdentityMatch: boolean;
  sourceRevisionMatch: boolean;
  registryRuntimeMatch: boolean;
  eventStorageMatch: boolean;
  publicationTransactionMatch: boolean;
  independentlyVerified: boolean;
}

export interface SettlementReference {
  paymentId: string;
  network: string;
  asset: Address;
  amountAtomic: string;
  assetDecimals: number;
  payer: Address;
  recipient: Address;
  transactionHash: Hex;
  blockTimestamp: string;
}

export interface SettlementExpectation {
  paymentId: string | null;
  network: string;
  asset: Address;
  amountAtomic: string;
  assetDecimals: number;
  payer: Address | null;
  recipient: Address;
  transactionHash: Hex | null;
  blockTimestamp: string | null;
}

export interface SettlementProof {
  expected: SettlementExpectation;
  reference: SettlementReference | null;
  present: boolean;
  receiptSuccess: boolean;
  independentlyVerified: boolean;
}

export interface PassportProof {
  runId: string;
  status: PassportStatus;
  identity: ContractIdentity;
  anchoredBlockTimestamp: string;
  gates: GateResults;
  verification: VerificationChecks;
  databaseChainMatch: boolean;
  inboundSettlement: SettlementProof;
  providerSettlement: SettlementProof;
  publicationTransactionHash: Hex;
  evidenceHash: Hex;
  manifestHash: Hex;
  inputHash: Hex;
  resultHash: Hex;
}

export interface OperationalFailure {
  code: OperationalReasonCode;
  explanation: string;
}

export interface PassportGateEvaluationInput {
  request: PassportGateRequest;
  config: PassportGateConfig;
  observedAt: string;
  currentContract?: CurrentLaunchContractProof;
  newestRelevantPassport?: PassportProof | null;
  operationalFailure?: OperationalFailure;
}

export interface ExplorerLinks {
  publicationTransaction: string | null;
  inboundSettlement: string | null;
  providerSettlement: string | null;
}

export interface RehearsalAction {
  kind: RehearsalActionKind;
  url: string;
  requiresExplicitPaymentApproval: true;
  automaticallyExecuted: false;
}

export interface PassportGateEvidenceView {
  observed_at: string;
  passport_age_hours: number | null;
  warn_age_hours: number;
  max_age_hours: number;
  expires_at: string | null;
  contract_identity: ContractIdentity | null;
  provider_address: Address | null;
  source_revision: string | null;
  run_id: string | null;
  passport_url: string | null;
  status: PassportStatus | null;
  gates: GateResults | null;
  independent_verification: boolean;
  database_chain_match: boolean | null;
  inbound_settlement: SettlementReference | null;
  provider_settlement: SettlementReference | null;
  evidence_publication_transaction: Hex | null;
  explorer_links: ExplorerLinks;
  evidence_hash: Hex | null;
  manifest_hash: Hex | null;
  input_hash: Hex | null;
  result_hash: Hex | null;
  rehearsal_action: RehearsalAction | null;
}

export interface PassportGateDecisionResult extends PassportGateEvidenceView {
  operational_status: "AVAILABLE";
  decision: PassportDecision;
  reason_codes: ReasonCode[];
  explanation: string;
}

export interface PassportGateUnavailableResult {
  operational_status: "UNAVAILABLE";
  decision: null;
  reason_codes: OperationalReasonCode[];
  explanation: string;
  observed_at: string;
}

export type PassportGateResult = PassportGateDecisionResult | PassportGateUnavailableResult;
