import type { LaunchContract } from "../launch-contract/schema.js";

export const gateNames = [
  "discoverable",
  "contract_correct",
  "fresh_challenge",
  "safe_to_rehearse",
  "paid_delivery",
] as const;

export type GateName = (typeof gateNames)[number];
export type GateState = "pass" | "fail" | "not_tested";
export type Gates = Record<GateName, GateState>;
export type PassportStatus = "verified" | "needs-attention" | "not-rehearsable";
export type FailureClassification = "invalid_output" | "schema_drift" | "timeout" | "unsafe_error" | null;
export type RunState =
  | "payment_required"
  | "payment_settled"
  | "queued"
  | "fetching_contract"
  | "discovering"
  | "fixed_sample"
  | "invalid_input"
  | "fresh_challenges"
  | "target_payment_or_not_tested"
  | "canonicalizing"
  | "publishing_on_chain"
  | "complete"
  | "complete_local"
  | "failed";

export interface FieldComparison {
  field: string;
  expected: unknown;
  actual: unknown;
  match: boolean;
  classification: FailureClassification;
}

export interface InvocationEvidence {
  kind: "fixed_sample" | "invalid_input" | "challenge" | "paid_delivery";
  index: number;
  input: Record<string, unknown>;
  expected: Record<string, unknown> | null;
  output: Record<string, unknown> | null;
  comparisons: FieldComparison[];
  structured_error: { code: number | string; message: string } | null;
  latency_ms: number;
  classification: FailureClassification;
}

export interface PaymentReference {
  payment_id: string;
  kind: "launchproof" | "target";
  amount: string;
  asset: string;
  network: string;
  payer: string | null;
  recipient: string | null;
  route: string;
  settlement_transaction: string | null;
  status: "settled" | "not_tested" | "local_only";
  timestamp: string;
}

export interface ProviderDeclaration {
  provider_address: string;
  manifest_hash: `0x${string}`;
  signature: string | null;
  verification_state: "verified" | "not_provided" | "invalid";
}

export interface CanonicalEvidence {
  schema_version: "1.0";
  run_id: string;
  target: string;
  label: "fixture" | "production" | "local_only";
  generated_at: string;
  manifest: LaunchContract;
  discovery: Record<string, unknown>;
  fixed_sample: InvocationEvidence;
  invalid_input: InvocationEvidence;
  challenges: InvocationEvidence[];
  timings: { invocation_ms: number[]; total_ms: number; observed_p95_ms: number };
  gates: Gates;
  passport_status: PassportStatus;
  provider_declaration: ProviderDeclaration;
  payments: { launchproof: PaymentReference; target: PaymentReference | null };
  hash_material: {
    inputs: Record<string, unknown>[];
    normalized_comparisons: FieldComparison[];
  };
  source_revision: string;
  build_commit: string;
  previous_run_id: string | null;
  remediation: string[];
  limitations: string[];
}

export interface ChainReference {
  registry_address: string;
  evidence_transaction_hash: string;
  block_number: string;
  explorer_url: string;
  published: boolean;
}

export interface RunRecord {
  run_id: string;
  idempotency_key: string;
  state: RunState;
  previous_run_id: string | null;
  label: "fixture" | "production" | "local_only";
  scope: "structured-extraction-v1 only";
  passport_status: PassportStatus;
  gates: Gates;
  canonical_evidence: CanonicalEvidence;
  canonical_evidence_jcs: string;
  evidence_hash: `0x${string}`;
  manifest_hash: `0x${string}`;
  input_hash: `0x${string}`;
  normalized_result_hash: `0x${string}`;
  source_version_sha: string;
  build_commit_sha: string;
  generated_at: string;
  provider_declaration: ProviderDeclaration;
  payment: PaymentReference;
  target_payment: PaymentReference | null;
  chain: ChainReference;
  remediation: string[];
  limitations: string[];
}

export interface RehearsalRequest {
  url: string;
  previous_run_id?: string;
  idempotency_key: string;
  payment: PaymentReference;
}
