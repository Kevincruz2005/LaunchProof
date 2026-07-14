import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  fallback as fallbackTransport,
  hexToString,
  http,
  stringToHex,
  verifyMessage,
  zeroAddress,
  zeroHash,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayer } from "viem/chains";
import type { Config } from "../config.js";
import type { Repository, RunProgress } from "../db/store.js";
import type { CanonicalEvidence, ChainReference, RunRecord } from "../domain/types.js";
import { contractStatus, gateBitmap } from "../domain/gates.js";
import { hashJcs, sha256, toJcs } from "../evidence/canonical.js";
import { manifestSigningBody } from "../launch-contract/schema.js";
import { registryAbi } from "./abi.js";

export interface EvidenceHashes {
  evidenceHash: `0x${string}`;
  manifestHash: `0x${string}`;
  inputHash: `0x${string}`;
  normalizedResultHash: `0x${string}`;
}

interface PublishedArgs extends EvidenceHashes {
  runId: `0x${string}`;
  sourceRevisionHash: `0x${string}`;
  paymentReceiptHash: `0x${string}`;
  previousRunId: `0x${string}`;
  provider: `0x${string}`;
  anchoredBy: `0x${string}`;
  anchoredAt: number | bigint;
  gateBitmap: number;
  status: number;
  providerSignatureVerified: boolean;
  isFixture: boolean;
  canonicalEvidence: `0x${string}`;
}

interface StoredChainRecord extends Omit<PublishedArgs, "runId" | "canonicalEvidence"> {}

interface LoadedChainRun {
  record: RunRecord;
  evidence: CanonicalEvidence;
  canonical: string;
  args: PublishedArgs;
  transactionHash: `0x${string}`;
  blockNumber: bigint | null;
  evidenceHashMatch: boolean;
  manifestHashMatch: boolean;
  inputHashMatch: boolean;
  resultHashMatch: boolean;
  providerSignatureMatch: boolean;
  gateStatusMatch: boolean;
  storageMatch: boolean;
  linkFieldsMatch: boolean;
  match: boolean;
}

export class RegistryService {
  constructor(private readonly config: Config) {}

  async publish(evidence: CanonicalEvidence, hashes: EvidenceHashes): Promise<ChainReference> {
    if (
      !this.config.productionReady ||
      !this.config.REGISTRY_ADDRESS ||
      !this.config.REGISTRY_WRITER_PRIVATE_KEY ||
      !this.config.XLAYER_RPC_URL
    ) {
      return { registry_address: this.config.REGISTRY_ADDRESS ?? zeroAddress, evidence_transaction_hash: zeroHash, block_number: "0", explorer_url: "", published: false };
    }
    const account = privateKeyToAccount(this.config.REGISTRY_WRITER_PRIVATE_KEY as `0x${string}`);
    const wallet = createWalletClient({ account, chain: xLayer, transport: http(this.config.XLAYER_RPC_URL) });
    const publicClient = this.client();
    const canonical = toJcs(evidence);
    const runId = evidence.run_id as `0x${string}`;
    const providerSignature =
      evidence.provider_declaration.verification_state === "verified" && evidence.provider_declaration.signature
        ? (evidence.provider_declaration.signature as `0x${string}`)
        : "0x";
    const txHash = await wallet.writeContract({
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      abi: registryAbi,
      functionName: "publishRun",
      args: [
        runId,
        {
          evidenceHash: hashes.evidenceHash,
          manifestHash: hashes.manifestHash,
          inputHash: hashes.inputHash,
          normalizedResultHash: hashes.normalizedResultHash,
          sourceRevisionHash: sha256(evidence.source_revision),
          paymentReceiptHash: hashJcs(evidence.payments.launchproof),
          previousRunId: evidence.previous_run_id ? (evidence.previous_run_id as `0x${string}`) : zeroHash,
          provider: evidence.provider_declaration.provider_address as `0x${string}`,
          anchoredBy: zeroAddress,
          anchoredAt: 0,
          gateBitmap: gateBitmap(evidence.gates),
          status: contractStatus(evidence.passport_status),
          providerSignatureVerified: evidence.provider_declaration.verification_state === "verified",
          isFixture: evidence.label === "fixture",
        },
        stringToHex(canonical),
        providerSignature,
      ],
      chain: xLayer,
      account,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 1, timeout: 60_000 });
    if (receipt.status !== "success") throw new Error("Registry publication reverted");
    return {
      registry_address: this.config.REGISTRY_ADDRESS,
      evidence_transaction_hash: txHash,
      block_number: receipt.blockNumber.toString(),
      explorer_url: `https://www.oklink.com/xlayer/tx/${txHash}`,
      published: true,
    };
  }

  async readPublishedRun(runId: string): Promise<RunRecord | null> {
    const loaded = await this.load(runId);
    return loaded?.match ? loaded.record : null;
  }

  async verify(runId: string, cache: RunRecord | null) {
    const loaded = await this.load(runId);
    if (!loaded) return emptyVerification(false);
    const cacheMatch = cache
      ? cache.evidence_hash === loaded.args.evidenceHash && cache.canonical_evidence_jcs === loaded.canonical
      : null;
    return {
      chain_record_found: true,
      evidence_hash_match: loaded.evidenceHashMatch,
      manifest_hash_match: loaded.manifestHashMatch,
      input_hash_match: loaded.inputHashMatch,
      result_hash_match: loaded.resultHashMatch,
      provider_signature_match: loaded.providerSignatureMatch,
      gate_status_match: loaded.gateStatusMatch,
      storage_match: loaded.storageMatch,
      link_fields_match: loaded.linkFieldsMatch,
      cache_match: cacheMatch,
      match: loaded.match,
      transaction_hash: loaded.transactionHash,
      block_number: loaded.blockNumber?.toString() ?? null,
      canonical_evidence: loaded.evidence,
    };
  }

  async rebuildIndex(repository: Repository): Promise<number> {
    if (!this.config.productionReady || !this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL) return 0;
    const client = this.client();
    const logs = await client.getLogs({
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      event: registryAbi[2],
      fromBlock: this.config.REGISTRY_DEPLOYMENT_BLOCK,
      toBlock: "latest",
      strict: true,
    });
    let indexed = 0;
    for (const log of logs) {
      const decoded = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics, strict: true });
      const runId = (decoded.args as unknown as PublishedArgs).runId;
      const loaded = await this.load(runId, client);
      if (!loaded?.match) throw new Error(`Refusing to index chain record ${runId}: verification failed`);
      const existing = await repository.getRun(runId);
      if (!existing) await repository.createProgress(progressFromRecord(loaded.record));
      await repository.savePayment(loaded.record.payment, runId);
      if (loaded.record.target_payment) await repository.savePayment(loaded.record.target_payment, runId);
      await repository.saveRun(loaded.record);
      indexed += 1;
    }
    return indexed;
  }

  private client(): PublicClient {
    return createPublicClient({ chain: xLayer, transport: readTransport(this.config) });
  }

  private async load(runId: string, client = this.client()): Promise<LoadedChainRun | null> {
    if (!this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL || !/^0x[0-9a-fA-F]{64}$/.test(runId)) return null;
    const stored = await client.readContract({
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      abi: registryAbi,
      functionName: "getRun",
      args: [runId as `0x${string}`],
    }) as unknown as StoredChainRecord;
    if (Number(stored.anchoredAt) === 0) return null;
    const logs = await client.getLogs({
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      event: registryAbi[2],
      args: { runId: runId as `0x${string}` },
      fromBlock: this.config.REGISTRY_DEPLOYMENT_BLOCK,
      toBlock: "latest",
      strict: true,
    });
    const log = logs[0];
    if (!log?.transactionHash) return null;
    const decoded = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics, strict: true });
    const args = decoded.args as unknown as PublishedArgs;
    const canonical = hexToString(args.canonicalEvidence);
    const evidence = JSON.parse(canonical) as CanonicalEvidence;
    const evidenceHash = sha256(canonical);
    const manifestHash = hashJcs(manifestSigningBody(evidence.manifest));
    const inputHash = hashJcs(evidence.hash_material.inputs);
    const resultHash = hashJcs(evidence.hash_material.normalized_comparisons);
    const evidenceHashMatch = evidenceHash === args.evidenceHash;
    const manifestHashMatch = manifestHash === args.manifestHash;
    const inputHashMatch = inputHash === args.inputHash;
    const resultHashMatch = resultHash === args.normalizedResultHash;
    const providerSignatureMatch = await declarationMatches(evidence, manifestHash, args);
    const gateStatusMatch = gateBitmap(evidence.gates) === args.gateBitmap && contractStatus(evidence.passport_status) === args.status;
    const expectedPreviousRun = evidence.previous_run_id ? evidence.previous_run_id.toLowerCase() : zeroHash;
    const linkFieldsMatch =
      evidence.run_id.toLowerCase() === args.runId.toLowerCase() &&
      sha256(evidence.source_revision) === args.sourceRevisionHash &&
      hashJcs(evidence.payments.launchproof) === args.paymentReceiptHash &&
      expectedPreviousRun === args.previousRunId.toLowerCase() &&
      evidence.provider_declaration.provider_address.toLowerCase() === args.provider.toLowerCase() &&
      (evidence.label === "fixture") === args.isFixture;
    const storageMatch = chainRecordMatchesEvent(stored, args);
    const match = evidenceHashMatch && manifestHashMatch && inputHashMatch && resultHashMatch && providerSignatureMatch && gateStatusMatch && storageMatch && linkFieldsMatch;
    const record = recordFromChain(evidence, canonical, args, this.config.REGISTRY_ADDRESS, log.transactionHash, log.blockNumber);
    return {
      record,
      evidence,
      canonical,
      args,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      evidenceHashMatch,
      manifestHashMatch,
      inputHashMatch,
      resultHashMatch,
      providerSignatureMatch,
      gateStatusMatch,
      storageMatch,
      linkFieldsMatch,
      match,
    };
  }
}

async function declarationMatches(evidence: CanonicalEvidence, manifestHash: `0x${string}`, args: PublishedArgs): Promise<boolean> {
  const declaration = evidence.provider_declaration;
  if (declaration.manifest_hash !== manifestHash || declaration.provider_address.toLowerCase() !== args.provider.toLowerCase()) return false;
  let validSignature = false;
  if (declaration.signature) {
    try {
      validSignature = await verifyMessage({
        address: declaration.provider_address as `0x${string}`,
        message: { raw: manifestHash },
        signature: declaration.signature as `0x${string}`,
      });
    } catch {
      validSignature = false;
    }
  }
  if (declaration.verification_state === "verified") return Boolean(declaration.signature) && validSignature && args.providerSignatureVerified;
  if (declaration.verification_state === "invalid") return Boolean(declaration.signature) && !validSignature && !args.providerSignatureVerified;
  return !declaration.signature && !args.providerSignatureVerified;
}

function chainRecordMatchesEvent(stored: StoredChainRecord, args: PublishedArgs): boolean {
  return (
    stored.evidenceHash === args.evidenceHash &&
    stored.manifestHash === args.manifestHash &&
    stored.inputHash === args.inputHash &&
    stored.normalizedResultHash === args.normalizedResultHash &&
    stored.sourceRevisionHash === args.sourceRevisionHash &&
    stored.paymentReceiptHash === args.paymentReceiptHash &&
    stored.previousRunId === args.previousRunId &&
    stored.provider.toLowerCase() === args.provider.toLowerCase() &&
    stored.anchoredBy.toLowerCase() === args.anchoredBy.toLowerCase() &&
    Number(stored.anchoredAt) === Number(args.anchoredAt) &&
    stored.gateBitmap === args.gateBitmap &&
    stored.status === args.status &&
    stored.providerSignatureVerified === args.providerSignatureVerified &&
    stored.isFixture === args.isFixture
  );
}

function recordFromChain(
  evidence: CanonicalEvidence,
  canonical: string,
  args: PublishedArgs,
  registryAddress: string,
  transactionHash: `0x${string}`,
  blockNumber: bigint | null,
): RunRecord {
  return {
    run_id: args.runId,
    idempotency_key: `chain:${args.runId}`,
    state: "complete",
    previous_run_id: evidence.previous_run_id,
    label: evidence.label,
    scope: "structured-extraction-v1 only",
    passport_status: evidence.passport_status,
    gates: evidence.gates,
    canonical_evidence: evidence,
    canonical_evidence_jcs: canonical,
    evidence_hash: args.evidenceHash,
    manifest_hash: args.manifestHash,
    input_hash: args.inputHash,
    normalized_result_hash: args.normalizedResultHash,
    source_version_sha: evidence.source_revision,
    build_commit_sha: evidence.build_commit,
    generated_at: evidence.generated_at,
    provider_declaration: evidence.provider_declaration,
    payment: evidence.payments.launchproof,
    target_payment: evidence.payments.target,
    chain: {
      registry_address: registryAddress,
      evidence_transaction_hash: transactionHash,
      block_number: blockNumber?.toString() ?? "0",
      explorer_url: `https://www.oklink.com/xlayer/tx/${transactionHash}`,
      published: true,
    },
    remediation: evidence.remediation,
    limitations: evidence.limitations,
  };
}

function progressFromRecord(record: RunRecord): RunProgress {
  return {
    run_id: record.run_id,
    idempotency_key: record.idempotency_key,
    state: "publishing_on_chain",
    target: record.canonical_evidence.target,
    created_at: record.generated_at,
    updated_at: record.generated_at,
    error: null,
  };
}

function readTransport(config: Config) {
  const transports = [http(config.XLAYER_RPC_URL), ...(config.XLAYER_FALLBACK_RPC_URL ? [http(config.XLAYER_FALLBACK_RPC_URL)] : [])];
  return transports.length > 1 ? fallbackTransport(transports) : transports[0]!;
}

function emptyVerification(found: boolean) {
  return {
    chain_record_found: found,
    evidence_hash_match: false,
    manifest_hash_match: false,
    input_hash_match: false,
    result_hash_match: false,
    provider_signature_match: false,
    gate_status_match: false,
    storage_match: false,
    link_fields_match: false,
    cache_match: null,
    match: false,
    transaction_hash: null,
    block_number: null,
    canonical_evidence: null,
  };
}
