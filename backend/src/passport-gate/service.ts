import { verifyMessage } from "viem";
import { z } from "zod";
import {
  PassportGateValidationError,
  evaluatePassportGate,
  makeContractIdentity,
  normalizeAddress,
  validatePassportGateConfig,
  validatePassportGateRequest,
  type Address,
  type CurrentLaunchContractProof,
  type PassportGateConfig,
  type PassportGateRequest,
  type PassportGateResult,
  type PassportProof,
  type SettlementExpectation,
  type SettlementProof,
  type SettlementReference,
} from "@launchproof/passport-gate";
import type { Config } from "../config.js";
import { RegistryService, type RegistryVerification } from "../chain/registry.js";
import type { Repository } from "../db/store.js";
import type { PaymentReference, RunRecord } from "../domain/types.js";
import { hashJcs, sha256, toJcs } from "../evidence/canonical.js";
import {
  manifestSigningBody,
  normalizeLaunchContractUrl,
  parseLaunchContract,
  type LaunchContract,
} from "../launch-contract/schema.js";
import { safeRequest } from "../security/safe-fetch.js";

const fullCommit = /^[0-9a-fA-F]{40}$/;
const evmAddress = /^0x(?!0{40}$)[0-9a-fA-F]{40}$/;
const zeroAddress = `0x${"0".repeat(40)}` as Address;

/** One adapter input schema is shared by REST and MCP before domain validation. */
export const passportGateRequestSchema = z.object({
  launch_contract_url: z.string().min(1).max(2_048),
  warn_age_hours: z.number().finite().nonnegative().optional(),
  max_age_hours: z.number().finite().positive().optional(),
  expected_provider_address: z.string().regex(evmAddress).transform((value) => value as Address).optional(),
  expected_source_revision: z.string().regex(fullCommit).optional(),
}).strict();

const gateOutputSchema = z.object({
  discoverable: z.boolean(),
  contract_correct: z.boolean(),
  fresh_challenge: z.boolean(),
  safe_to_rehearse: z.boolean(),
  paid_delivery: z.boolean(),
}).strict();
const identityOutputSchema = z.object({
  launchContractUrl: z.string().url(),
  manifestHash: z.string(),
  providerAddress: z.string(),
  sourceRevision: z.string(),
  identityHash: z.string(),
}).strict();
const settlementOutputSchema = z.object({
  paymentId: z.string(),
  network: z.string(),
  asset: z.string(),
  amountAtomic: z.string(),
  assetDecimals: z.number().int().nonnegative(),
  payer: z.string(),
  recipient: z.string(),
  transactionHash: z.string(),
  blockTimestamp: z.string().datetime({ offset: true }),
}).strict();
const explorerLinksOutputSchema = z.object({
  publicationTransaction: z.string().url().nullable(),
  inboundSettlement: z.string().url().nullable(),
  providerSettlement: z.string().url().nullable(),
}).strict();
const rehearsalActionOutputSchema = z.object({
  kind: z.enum(["REHEARSE", "RENEW"]),
  url: z.string().url(),
  requiresExplicitPaymentApproval: z.literal(true),
  automaticallyExecuted: z.literal(false),
}).strict();

/** MCP SDK 1.x accepts a raw Zod shape for portable input/output tool metadata. */
export const passportGateMcpOutputShape = {
  operational_status: z.enum(["AVAILABLE", "UNAVAILABLE"]),
  decision: z.enum(["ALLOW", "WARN", "BLOCK", "REHEARSAL_REQUIRED"]).nullable(),
  reason_codes: z.array(z.string()).min(1),
  explanation: z.string(),
  observed_at: z.string().datetime({ offset: true }),
  error: z.literal("verification_unavailable").optional(),
  retry_safe: z.literal(true).optional(),
  passport_age_hours: z.number().nonnegative().nullable().optional(),
  warn_age_hours: z.number().nonnegative().optional(),
  max_age_hours: z.number().positive().optional(),
  expires_at: z.string().datetime({ offset: true }).nullable().optional(),
  contract_identity: identityOutputSchema.nullable().optional(),
  provider_address: z.string().nullable().optional(),
  source_revision: z.string().nullable().optional(),
  run_id: z.string().nullable().optional(),
  passport_url: z.string().url().nullable().optional(),
  status: z.enum(["Verified", "NeedsAttention", "NotRehearsable"]).nullable().optional(),
  gates: gateOutputSchema.nullable().optional(),
  independent_verification: z.boolean().optional(),
  database_chain_match: z.boolean().nullable().optional(),
  inbound_settlement: settlementOutputSchema.nullable().optional(),
  provider_settlement: settlementOutputSchema.nullable().optional(),
  evidence_publication_transaction: z.string().nullable().optional(),
  explorer_links: explorerLinksOutputSchema.optional(),
  evidence_hash: z.string().nullable().optional(),
  manifest_hash: z.string().nullable().optional(),
  input_hash: z.string().nullable().optional(),
  result_hash: z.string().nullable().optional(),
  rehearsal_action: rehearsalActionOutputSchema.nullable().optional(),
};

export interface PassportGateAdapter {
  check(request: PassportGateRequest): Promise<PassportGateResult>;
}

export interface PassportGateServiceDependencies {
  loadCurrentContract?: (url: string) => Promise<{
    currentContract: CurrentLaunchContractProof;
    manifest: LaunchContract | null;
  }>;
  now?: () => Date;
}

export function passportGateTransportBody(result: PassportGateResult): Record<string, unknown> {
  if (result.operational_status === "AVAILABLE") return result as unknown as Record<string, unknown>;
  return {
    error: "verification_unavailable",
    retry_safe: true,
    ...result,
  };
}

export class PassportGateService implements PassportGateAdapter {
  private readonly registry: RegistryService;
  private readonly gateConfig: PassportGateConfig;

  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
    registry: RegistryService = new RegistryService(config),
    private readonly dependencies: PassportGateServiceDependencies = {},
  ) {
    this.registry = registry;
    this.gateConfig = validatePassportGateConfig({
      chainId: config.chain.id as 1952,
      network: config.chain.network as "eip155:1952",
      assetAddress: config.chain.usdt0Address,
      assetDecimals: config.chain.usdt0Decimals,
      defaultWarnAgeHours: config.PASSPORT_GATE_WARN_AGE_HOURS,
      defaultMaxAgeHours: config.PASSPORT_GATE_MAX_AGE_HOURS,
      explorerBaseUrl: config.chain.explorerUrl,
      passportBaseUrl: config.PUBLIC_WEB_BASE_URL,
      rehearsalBaseUrl: config.PUBLIC_WEB_BASE_URL,
      deploymentMode: config.NODE_ENV === "production" ? "public" : "local",
    });
  }

  async check(input: PassportGateRequest): Promise<PassportGateResult> {
    const parsed = passportGateRequestSchema.parse(input) as PassportGateRequest;
    const normalizedInput: PassportGateRequest = {
      ...parsed,
      launch_contract_url: normalizeLaunchContractUrl(parsed.launch_contract_url),
    };
    const request = validatePassportGateRequest(normalizedInput, this.gateConfig);
    const observedAt = (this.dependencies.now?.() ?? new Date()).toISOString();

    let currentContract: CurrentLaunchContractProof;
    let manifest: LaunchContract | null = null;
    try {
      const loaded = this.dependencies.loadCurrentContract
        ? await this.dependencies.loadCurrentContract(request.launchContractUrl)
        : await loadCurrentContract(request.launchContractUrl, this.config);
      currentContract = loaded.currentContract;
      manifest = loaded.manifest;
    } catch (error) {
      if (error instanceof PassportGateValidationError || error instanceof z.ZodError) throw error;
      return this.unavailable(normalizedInput, observedAt, "CONTRACT_FETCH_UNAVAILABLE", "The current Launch Contract could not be loaded safely.");
    }

    const currentOnly = evaluatePassportGate({
      request: normalizedInput,
      config: this.gateConfig,
      observedAt,
      currentContract,
      newestRelevantPassport: null,
    });
    if (!manifest || (currentOnly.operational_status === "AVAILABLE" && currentOnly.decision === "BLOCK")) {
      return currentOnly;
    }

    if (!this.config.chainReady) {
      return this.unavailable(normalizedInput, observedAt, "RPC_UNAVAILABLE", "Independent X Layer verification is not configured.");
    }

    try {
      await this.registry.assertVerificationAvailable();
    } catch (error) {
      const code = operationalCode(error);
      return this.unavailable(normalizedInput, observedAt, code, "The configured X Layer registry verification boundary is unavailable.");
    }

    let candidates: RunRecord[];
    try {
      candidates = (await this.repository.passportsForTarget(request.launchContractUrl, manifest.provider_address))
        .filter((run) => sameTarget(run.canonical_evidence.target, request.launchContractUrl));
    } catch {
      return this.unavailable(normalizedInput, observedAt, "INDEX_UNAVAILABLE", "The Passport discovery index is temporarily unavailable.");
    }

    let newest: { proof: PassportProof; anchoredAt: number } | null = null;
    try {
      for (const candidate of candidates) {
        const verification = await this.registry.verifyStrict(candidate.run_id, candidate);
        const proof = proofFromVerification(candidate, verification, currentContract, this.config);
        const anchoredAt = verification.anchored_at ? Date.parse(verification.anchored_at) : Date.parse(candidate.generated_at);
        if (!newest || anchoredAt > newest.anchoredAt) newest = { proof, anchoredAt };
      }
    } catch (error) {
      const code = operationalCode(error);
      return this.unavailable(normalizedInput, observedAt, code, "Independent X Layer proof reconstruction is temporarily unavailable.");
    }

    return evaluatePassportGate({
      request: normalizedInput,
      config: this.gateConfig,
      observedAt,
      currentContract,
      newestRelevantPassport: newest?.proof ?? null,
    });
  }

  private unavailable(
    request: PassportGateRequest,
    observedAt: string,
    code: "RPC_UNAVAILABLE" | "RPC_TIMEOUT" | "RPC_RATE_LIMITED" | "INDEX_UNAVAILABLE" | "CONTRACT_FETCH_UNAVAILABLE" | "INTERNAL_UNAVAILABLE",
    explanation: string,
  ): PassportGateResult {
    return evaluatePassportGate({
      request,
      config: this.gateConfig,
      observedAt,
      operationalFailure: { code, explanation },
    });
  }
}

async function loadCurrentContract(url: string, config: Config): Promise<{
  currentContract: CurrentLaunchContractProof;
  manifest: LaunchContract | null;
}> {
  const response = await safeRequest(url, config, { timeoutMs: 8_000 });
  if (response.status < 200 || response.status >= 300) throw new Error(`Launch Contract returned HTTP ${response.status}`);
  let raw: unknown;
  try {
    raw = JSON.parse(response.text) as unknown;
  } catch {
    throw new Error("Launch Contract returned invalid JSON");
  }
  try {
    const manifest = parseLaunchContract(raw, config);
    const manifestHash = hashJcs(manifestSigningBody(manifest));
    let signatureValid = false;
    if (manifest.declaration_signature) {
      try {
        signatureValid = await verifyMessage({
          address: manifest.provider_address as `0x${string}`,
          message: { raw: manifestHash },
          signature: manifest.declaration_signature as `0x${string}`,
        });
      } catch {
        signatureValid = false;
      }
    }
    return {
      manifest,
      currentContract: {
        launchContractUrl: url,
        manifestHash,
        providerAddress: manifest.provider_address as Address,
        sourceRevision: manifest.source_revision,
        schemaValid: true,
        signatureValid,
        manifestHashValid: true,
        safeFetchVerified: true,
      },
    };
  } catch (error) {
    if (!(error instanceof z.ZodError) && !(error instanceof Error && /Launch Contract payment/.test(error.message))) {
      throw error;
    }
    return { manifest: null, currentContract: invalidContractProof(url, raw) };
  }
}

function invalidContractProof(url: string, raw: unknown): CurrentLaunchContractProof {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const provider = typeof value.provider_address === "string" && evmAddress.test(value.provider_address)
    ? value.provider_address as Address
    : zeroAddress;
  return {
    launchContractUrl: url,
    manifestHash: hashJcs(raw),
    providerAddress: provider,
    sourceRevision: typeof value.source_revision === "string" ? value.source_revision : "invalid",
    schemaValid: false,
    signatureValid: false,
    manifestHashValid: true,
    safeFetchVerified: true,
  };
}

function proofFromVerification(
  cache: RunRecord,
  verification: RegistryVerification,
  current: CurrentLaunchContractProof,
  config: Config,
): PassportProof {
  const evidence = verification.canonical_evidence ?? cache.canonical_evidence;
  const manifestHash = hashJcs(manifestSigningBody(evidence.manifest));
  const identity = makeContractIdentity({
    launchContractUrl: evidence.target,
    manifestHash,
    providerAddress: evidence.provider_declaration.provider_address,
    sourceRevision: evidence.source_revision,
  });
  const inbound = settlementProof(
    evidence.payments.launchproof,
    {
      network: config.chain.network,
      asset: config.chain.usdt0Address,
      amountAtomic: evidence.previous_run_id ? "100000" : "10000",
      assetDecimals: config.chain.usdt0Decimals,
      recipient: config.PAYOUT_ADDRESS ?? evidence.payments.launchproof.recipient,
    },
    verification.launch_payment_transfer_match,
  );
  const provider = settlementProof(
    evidence.payments.target,
    {
      network: config.chain.network,
      asset: config.chain.usdt0Address,
      amountAtomic: evidence.manifest.payment?.amount ?? "0",
      assetDecimals: config.chain.usdt0Decimals,
      recipient: evidence.manifest.payment?.recipient ?? null,
    },
    verification.target_payment_transfer_match === true,
  );
  const currentIdentity = makeContractIdentity(current);
  return {
    runId: evidence.run_id,
    status: evidence.passport_status === "verified"
      ? "Verified"
      : evidence.passport_status === "needs-attention" ? "NeedsAttention" : "NotRehearsable",
    identity,
    anchoredBlockTimestamp: verification.anchored_at ?? "invalid",
    gates: {
      discoverable: evidence.gates.discoverable === "pass",
      contract_correct: evidence.gates.contract_correct === "pass",
      fresh_challenge: evidence.gates.fresh_challenge === "pass",
      safe_to_rehearse: evidence.gates.safe_to_rehearse === "pass",
      paid_delivery: evidence.gates.paid_delivery === "pass",
    },
    verification: {
      chainRecordFound: verification.chain_record_found,
      canonicalEvidenceMatch: verification.canonical_jcs_match && verification.evidence_semantics_match,
      evidenceHashMatch: verification.evidence_hash_match,
      manifestHashMatch: verification.manifest_hash_match,
      inputHashMatch: verification.input_hash_match,
      resultHashMatch: verification.result_hash_match,
      providerSignatureMatch: verification.provider_signature_match,
      contractIdentityMatch: verification.link_fields_match && identity.identityHash === currentIdentity.identityHash,
      sourceRevisionMatch: verification.link_fields_match && identity.sourceRevision === currentIdentity.sourceRevision,
      registryRuntimeMatch: verification.registry_runtime_match,
      eventStorageMatch: verification.storage_match,
      publicationTransactionMatch: Boolean(verification.transaction_hash && verification.block_number),
      independentlyVerified: verification.match,
    },
    databaseChainMatch: verification.cache_match === true,
    inboundSettlement: inbound,
    providerSettlement: provider,
    publicationTransactionHash: (verification.transaction_hash ?? cache.chain.evidence_transaction_hash) as `0x${string}`,
    evidenceHash: sha256(toJcs(evidence)),
    manifestHash,
    inputHash: hashJcs(evidence.hash_material.inputs),
    resultHash: hashJcs(evidence.hash_material.normalized_comparisons),
  };
}

function settlementProof(
  payment: PaymentReference | null,
  expectedPolicy: {
    network: string;
    asset: string;
    amountAtomic: string;
    assetDecimals: number;
    recipient: string | null;
  },
  independentlyVerified: boolean,
): SettlementProof {
  const reference = paymentReference(payment);
  const expected: SettlementExpectation = reference
    ? {
        ...reference,
        network: expectedPolicy.network,
        asset: expectedPolicy.asset as Address,
        amountAtomic: expectedPolicy.amountAtomic,
        assetDecimals: expectedPolicy.assetDecimals,
        recipient: (expectedPolicy.recipient ?? reference.recipient) as Address,
      }
    : {
        paymentId: null,
        network: expectedPolicy.network,
        asset: expectedPolicy.asset as Address,
        amountAtomic: expectedPolicy.amountAtomic,
        assetDecimals: expectedPolicy.assetDecimals,
        payer: null,
        recipient: (expectedPolicy.recipient && evmAddress.test(expectedPolicy.recipient)
          ? expectedPolicy.recipient
          : zeroAddress) as Address,
        transactionHash: null,
        blockTimestamp: null,
      };
  return {
    expected,
    reference,
    present: reference !== null,
    receiptSuccess: independentlyVerified,
    independentlyVerified,
  };
}

function paymentReference(payment: PaymentReference | null): SettlementReference | null {
  if (!payment?.payer || !payment.recipient || !payment.settlement_transaction) return null;
  try {
    return {
      paymentId: payment.payment_id,
      network: payment.network,
      asset: normalizeAddress(payment.asset),
      amountAtomic: payment.amount_atomic,
      assetDecimals: payment.asset_decimals,
      payer: normalizeAddress(payment.payer),
      recipient: normalizeAddress(payment.recipient),
      transactionHash: payment.settlement_transaction as `0x${string}`,
      blockTimestamp: payment.timestamp,
    };
  } catch {
    return null;
  }
}

function sameTarget(left: string, right: string): boolean {
  try {
    return normalizeLaunchContractUrl(left) === normalizeLaunchContractUrl(right);
  } catch {
    return false;
  }
}

function operationalCode(error: unknown): "RPC_UNAVAILABLE" | "RPC_TIMEOUT" | "RPC_RATE_LIMITED" | "INTERNAL_UNAVAILABLE" {
  const message = error instanceof Error ? `${error.name} ${error.message}` : "";
  if (/429|rate.?limit/i.test(message)) return "RPC_RATE_LIMITED";
  if (/timeout|timed out|abort/i.test(message)) return "RPC_TIMEOUT";
  if (/rpc|transport|network|fetch|socket|connect/i.test(message)) return "RPC_UNAVAILABLE";
  return "INTERNAL_UNAVAILABLE";
}
