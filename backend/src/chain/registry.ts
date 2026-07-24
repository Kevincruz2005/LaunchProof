import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  encodeFunctionData,
  fallback as fallbackTransport,
  hexToString,
  http,
  keccak256,
  stringToHex,
  verifyMessage,
  zeroAddress,
  zeroHash,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { xLayerTestnet } from "viem/chains";
import pLimit from "p-limit";
import type { Config } from "../config.js";
import type { Repository, RunProgress } from "../db/store.js";
import type { CanonicalEvidence, ChainReference, PaymentReference, RunRecord } from "../domain/types.js";
import { contractStatus, gateBitmap, passportStatus } from "../domain/gates.js";
import { hashJcs, sha256, toJcs } from "../evidence/canonical.js";
import { validateCanonicalEvidence } from "../evidence/validate.js";
import { manifestSigningBody } from "../launch-contract/schema.js";
import { registryAbi } from "./abi.js";
import { AlwaysLeader, type LeaderGuard } from "../leadership/leader.js";

const registryWriterLimit = pLimit(1);

export class PublicationOutcomeUnknownError extends Error {
  constructor(readonly transactionHash: `0x${string}` | null, cause?: unknown) {
    super(
      transactionHash
        ? `Registry publication outcome could not be proven for ${transactionHash}`
        : "Registry publication submission outcome could not be proven",
      { cause },
    );
    this.name = "PublicationOutcomeUnknownError";
  }
}

export function runtimeBytecodeMatches(
  code: string | undefined,
  expectedHash: string | undefined,
): boolean {
  return Boolean(
    code &&
    code !== "0x" &&
    expectedHash &&
    /^0x[0-9a-f]*$/i.test(code) &&
    /^0x[0-9a-f]{64}$/i.test(expectedHash) &&
    keccak256(code as Hex).toLowerCase() === expectedHash.toLowerCase(),
  );
}

export function assertRuntimeBytecode(
  code: string | undefined,
  expectedHash: string,
): void {
  if (!runtimeBytecodeMatches(code, expectedHash)) throw new Error("Registry runtime bytecode mismatch");
}

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
  canonicalJcsMatch: boolean;
  manifestHashMatch: boolean;
  inputHashMatch: boolean;
  resultHashMatch: boolean;
  providerSignatureMatch: boolean;
  gateStatusMatch: boolean;
  storageMatch: boolean;
  linkFieldsMatch: boolean;
  evidenceSemanticsMatch: boolean;
  launchPaymentTransferMatch: boolean;
  targetPaymentTransferMatch: boolean | null;
  registryRuntimeMatch: boolean;
  match: boolean;
}

export interface RegistryVerification {
  chain_record_found: boolean;
  evidence_hash_match: boolean;
  canonical_jcs_match: boolean;
  manifest_hash_match: boolean;
  input_hash_match: boolean;
  result_hash_match: boolean;
  provider_signature_match: boolean;
  gate_status_match: boolean;
  storage_match: boolean;
  link_fields_match: boolean;
  evidence_semantics_match: boolean;
  launch_payment_transfer_match: boolean;
  target_payment_transfer_match: boolean | null;
  registry_runtime_match: boolean;
  cache_match: boolean | null;
  match: boolean;
  transaction_hash: `0x${string}` | null;
  block_number: string | null;
  anchored_at: string | null;
  canonical_evidence: CanonicalEvidence | null;
}

export class RegistryService {
  constructor(private readonly config: Config, private readonly leadership: LeaderGuard = new AlwaysLeader()) {}

  async publish(
    evidence: CanonicalEvidence,
    hashes: EvidenceHashes,
    onPrepared?: (transactionHash: `0x${string}`) => Promise<void>,
  ): Promise<ChainReference> {
    if (evidence.execution_mode === "testnet") await this.leadership.assertLeader("registry-publication");
    return registryWriterLimit(() => this.publishExclusive(evidence, hashes, onPrepared));
  }

  private async publishExclusive(
    evidence: CanonicalEvidence,
    hashes: EvidenceHashes,
    onPrepared?: (transactionHash: `0x${string}`) => Promise<void>,
  ): Promise<ChainReference> {
    if (
      evidence.execution_mode !== "testnet" ||
      evidence.payments.launchproof.status !== "settled" ||
      !this.config.chainReady ||
      !this.config.REGISTRY_ADDRESS ||
      !this.config.REGISTRY_WRITER_PRIVATE_KEY ||
      !this.config.XLAYER_RPC_URL
    ) {
      return { registry_address: this.config.REGISTRY_ADDRESS ?? zeroAddress, evidence_transaction_hash: zeroHash, block_number: "0", explorer_url: "", published: false };
    }
    const account = privateKeyToAccount(this.config.REGISTRY_WRITER_PRIVATE_KEY as `0x${string}`);
    const activeChain = this.activeChain();
    const wallet = createWalletClient({ account, chain: activeChain, transport: http(this.config.XLAYER_RPC_URL) });
    const publicClient = this.client();
    const canonical = toJcs(evidence);
    const runId = evidence.run_id as `0x${string}`;
    const alreadyPublished = await this.load(runId, publicClient);
    if (alreadyPublished) {
      if (alreadyPublished.match &&
        alreadyPublished.args.evidenceHash === hashes.evidenceHash &&
        alreadyPublished.canonical === canonical) {
        return chainReferenceFromLoaded(alreadyPublished, this.config.REGISTRY_ADDRESS, this.config.chain.explorerUrl);
      }
      throw new Error("Run ID is already published with different evidence");
    }
    const providerSignature =
      evidence.provider_declaration.verification_state === "verified" && evidence.provider_declaration.signature
        ? (evidence.provider_declaration.signature as `0x${string}`)
        : "0x";
    const data = encodeFunctionData({
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
    });
    let serializedTransaction: `0x${string}`;
    try {
      const prepared = await wallet.prepareTransactionRequest({
        account,
        chain: activeChain,
        to: this.config.REGISTRY_ADDRESS as `0x${string}`,
        data,
      });
      serializedTransaction = await wallet.signTransaction(prepared);
    } catch (error) {
      throw new PublicationOutcomeUnknownError(null, error);
    }
    const txHash = keccak256(serializedTransaction);
    // Persist the exact signed transaction hash and immutable evidence candidate before it can reach the RPC.
    try {
      await onPrepared?.(txHash);
    } catch (error) {
      throw new Error("Registry publication was not broadcast because its recovery candidate could not be persisted", { cause: error });
    }
    await this.leadership.assertLeader("registry-publication");
    try {
      const rpcChainId = await publicClient.getChainId();
      if (rpcChainId !== 1952 || rpcChainId !== this.config.chain.id) {
        throw new Error(`Registry broadcast refused: RPC returned chain ${rpcChainId}, expected 1952`);
      }
      const submittedHash = await wallet.sendRawTransaction({ serializedTransaction });
      if (submittedHash.toLowerCase() !== txHash.toLowerCase()) {
        throw new Error(`RPC returned transaction hash ${submittedHash}, expected ${txHash}`);
      }
    } catch (error) {
      throw new PublicationOutcomeUnknownError(txHash, error);
    }
    let receipt;
    try {
      receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, confirmations: 2, timeout: 60_000 });
    } catch (error) {
      const recovered = await this.load(runId, publicClient).catch(() => null);
      if (recovered?.match && recovered.args.evidenceHash === hashes.evidenceHash && recovered.canonical === canonical) {
        return chainReferenceFromLoaded(recovered, this.config.REGISTRY_ADDRESS, this.config.chain.explorerUrl);
      }
      throw new PublicationOutcomeUnknownError(txHash, error);
    }
    if (receipt.status !== "success") throw new Error("Registry publication reverted");
    const confirmed = await this.load(runId, publicClient, txHash).catch(() => null);
    if (!confirmed?.match || confirmed.args.evidenceHash !== hashes.evidenceHash || confirmed.canonical !== canonical) {
      throw new PublicationOutcomeUnknownError(txHash);
    }
    return chainReferenceFromLoaded(confirmed, this.config.REGISTRY_ADDRESS, this.config.chain.explorerUrl);
  }

  async healthCheck(): Promise<boolean> {
    if (!this.config.chainReady || !this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL) return false;
    try {
      const client = this.client();
      const [chainId, code] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: this.config.REGISTRY_ADDRESS as `0x${string}` }),
      ]);
      return chainId === this.config.chain.id && runtimeBytecodeMatches(code, this.config.REGISTRY_RUNTIME_CODE_HASH);
    } catch {
      return false;
    }
  }

  /** Prove the configured read-only verification boundary before an absence can be trusted. */
  async assertVerificationAvailable(): Promise<void> {
    if (!this.config.chainReady || !this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL || !this.config.REGISTRY_RUNTIME_CODE_HASH) {
      throw new Error("Registry verification is not configured");
    }
    const client = this.client();
    const [chainId, code] = await Promise.all([
      client.getChainId(),
      client.getCode({ address: this.config.REGISTRY_ADDRESS as `0x${string}` }),
      client.getBlockNumber(),
    ]);
    if (chainId !== 1952 || chainId !== this.config.chain.id) throw new Error("Registry RPC chain identity mismatch");
    assertRuntimeBytecode(code, this.config.REGISTRY_RUNTIME_CODE_HASH);
  }

  async readPublishedRun(runId: string, cache: RunRecord | null = null): Promise<RunRecord | null> {
    try {
      const loaded = await this.load(runId, this.client(), cache?.chain.evidence_transaction_hash);
      return loaded?.match ? loaded.record : null;
    } catch {
      return null;
    }
  }

  async verify(runId: string, cache: RunRecord | null): Promise<RegistryVerification> {
    try {
      return await this.verifyStrict(runId, cache);
    } catch {
      return emptyVerification(false);
    }
  }

  /** Read-only verifier that preserves transport failures for trust-gate adapters to report as unavailable. */
  async verifyStrict(runId: string, cache: RunRecord | null): Promise<RegistryVerification> {
    const loaded = await this.load(runId, this.client(), cache?.chain.evidence_transaction_hash, true);
    if (!loaded) return emptyVerification(false);
    const cacheMatch = cache ? cacheMatchesLoaded(cache, loaded) : null;
    return {
      chain_record_found: true,
      evidence_hash_match: loaded.evidenceHashMatch,
      canonical_jcs_match: loaded.canonicalJcsMatch,
      manifest_hash_match: loaded.manifestHashMatch,
      input_hash_match: loaded.inputHashMatch,
      result_hash_match: loaded.resultHashMatch,
      provider_signature_match: loaded.providerSignatureMatch,
      gate_status_match: loaded.gateStatusMatch,
      storage_match: loaded.storageMatch,
      link_fields_match: loaded.linkFieldsMatch,
      evidence_semantics_match: loaded.evidenceSemanticsMatch,
      launch_payment_transfer_match: loaded.launchPaymentTransferMatch,
      target_payment_transfer_match: loaded.targetPaymentTransferMatch,
      registry_runtime_match: loaded.registryRuntimeMatch,
      cache_match: cacheMatch,
      match: loaded.match,
      transaction_hash: loaded.transactionHash,
      block_number: loaded.blockNumber?.toString() ?? null,
      anchored_at: new Date(Number(loaded.args.anchoredAt) * 1_000).toISOString(),
      canonical_evidence: loaded.evidence,
    };
  }

  async rebuildIndex(repository: Repository): Promise<number> {
    if (!this.config.chainReady || !this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL) return 0;
    await this.leadership.assertLeader("chain-index");
    const client = this.client();
    const cursorKey = `${this.config.chain.network}:${this.config.REGISTRY_ADDRESS.toLowerCase()}`;
    const [latestBlock, cursor] = await Promise.all([
      client.getBlockNumber(),
      repository.getChainCursor(cursorKey),
    ]);
    const overlapStart = cursor && cursor > 12n ? cursor - 12n : this.config.REGISTRY_DEPLOYMENT_BLOCK;
    const fromBlock = overlapStart > this.config.REGISTRY_DEPLOYMENT_BLOCK
      ? overlapStart
      : this.config.REGISTRY_DEPLOYMENT_BLOCK;
    const logs = await this.getLogsChunked(client, {
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      event: registryAbi[2],
      fromBlock,
      toBlock: latestBlock,
      strict: true,
    });
    let indexed = 0;
    for (const log of logs) {
      await this.leadership.assertLeader("chain-index");
      const decoded = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics, strict: true });
      const runId = (decoded.args as unknown as PublishedArgs).runId;
      const loaded = await this.load(runId, client);
      if (!loaded?.match) {
        // A malformed or historically incompatible record must never poison the
        // entire public index. Quarantine it and continue indexing independently
        // verifiable records; readPublishedRun still fails closed for this run.
        process.stderr.write(JSON.stringify({
          event: "chain_record_quarantined",
          run_id: runId,
          reason: "verification_failed",
        }) + "\n");
        continue;
      }
      const existing = await repository.getRun(runId);
      const record = existing
        ? { ...loaded.record, idempotency_key: existing.idempotency_key }
        : loaded.record;
      await this.leadership.assertLeader("chain-index");
      if (!existing) await repository.createProgress(progressFromRecord(record));
      await repository.savePayment(record.payment, runId);
      if (record.target_payment) await repository.savePayment(record.target_payment, runId);
      await repository.saveRun(record);
      indexed += 1;
    }
    await this.leadership.assertLeader("chain-index");
    await repository.saveChainCursor(cursorKey, latestBlock);
    return indexed;
  }

  /** Reconciles only persisted exact candidates; unknown or pending outcomes remain explicitly pending. */
  async reconcilePendingPublications(repository: Repository): Promise<number> {
    if (!this.config.chainReady || !this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL) return 0;
    await this.leadership.assertLeader("publication-recovery");
    const client = this.client();
    let finalized = 0;
    for (const progress of await repository.pendingPublications()) {
      await this.leadership.assertLeader("publication-recovery");
      const publication = progress.publication;
      if (!publication?.candidate || !/^0x[0-9a-fA-F]{64}$/.test(publication.transaction_hash)) continue;
      const candidate = publication.candidate;
      const loaded = await this.load(progress.run_id, client, publication.transaction_hash).catch(() => null);
      if (
        loaded?.match &&
        loaded.args.evidenceHash.toLowerCase() === publication.evidence_hash.toLowerCase() &&
        loaded.canonical === candidate.canonical_evidence_jcs
      ) {
        await this.leadership.assertLeader("publication-recovery");
        await finalizeReconciledRun(repository, {
          ...loaded.record,
          idempotency_key: candidate.idempotency_key,
        });
        finalized += 1;
        continue;
      }

      let receipt;
      try {
        receipt = await client.getTransactionReceipt({ hash: publication.transaction_hash as `0x${string}` });
      } catch {
        // Missing, pending, dropped, and RPC-indeterminate transactions are not safe to replace.
        continue;
      }
      if (receipt.status !== "reverted") continue;

      const hashes: EvidenceHashes = {
        evidenceHash: candidate.evidence_hash,
        manifestHash: candidate.manifest_hash,
        inputHash: candidate.input_hash,
        normalizedResultHash: candidate.normalized_result_hash,
      };
      try {
        const chain = await this.publish(candidate.canonical_evidence, hashes, async (transactionHash) => {
          await this.leadership.assertLeader("publication-recovery");
          const nextCandidate: RunRecord = {
            ...candidate,
            state: "publishing_on_chain",
            chain: pendingChainReference(this.config, transactionHash),
          };
          await repository.recordPublicationAttempt(progress.run_id, {
            transaction_hash: transactionHash,
            evidence_hash: candidate.evidence_hash,
            started_at: new Date().toISOString(),
            candidate: nextCandidate,
          });
        });
        await this.leadership.assertLeader("publication-recovery");
        await finalizeReconciledRun(repository, { ...candidate, state: "complete", chain });
        finalized += 1;
      } catch (error) {
        if (!(error instanceof PublicationOutcomeUnknownError)) throw error;
      }
    }
    return finalized;
  }

  private activeChain() {
    return xLayerTestnet;
  }

  private client(): PublicClient {
    return createPublicClient({ chain: this.activeChain(), transport: readTransport(this.config) });
  }

  private async load(
    runId: string,
    client = this.client(),
    transactionHint?: string,
    preserveOperationalErrors = false,
  ): Promise<LoadedChainRun | null> {
    if (!this.config.REGISTRY_ADDRESS || !this.config.XLAYER_RPC_URL || !/^0x[0-9a-fA-F]{64}$/.test(runId)) return null;
    const [stored, registryCode] = await Promise.all([
      client.readContract({
        address: this.config.REGISTRY_ADDRESS as `0x${string}`,
        abi: registryAbi,
        functionName: "getRun",
        args: [runId as `0x${string}`],
      }) as Promise<unknown> as Promise<StoredChainRecord>,
      client.getCode({ address: this.config.REGISTRY_ADDRESS as `0x${string}` }),
    ]);
    if (Number(stored.anchoredAt) === 0) return null;
    const registryRuntimeMatch = runtimeBytecodeMatches(registryCode, this.config.REGISTRY_RUNTIME_CODE_HASH);
    const logs = /^0x[0-9a-fA-F]{64}$/.test(transactionHint ?? "")
      ? await this.logsFromReceipt(client, transactionHint as `0x${string}`, runId as `0x${string}`)
      : await this.logsAtAnchoredTimestamp(client, runId as `0x${string}`, BigInt(stored.anchoredAt));
    const log = logs[0];
    if (!log?.transactionHash) return null;
    const decoded = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics, strict: true });
    const args = decoded.args as unknown as PublishedArgs;
    let canonical: string;
    let evidence: CanonicalEvidence;
    try {
      canonical = hexToString(args.canonicalEvidence);
      const rawEvidence = JSON.parse(canonical) as unknown;
      const semantic = validateCanonicalEvidence(rawEvidence, this.config, args.runId, Number(args.anchoredAt));
      if (!semantic) return null;
      evidence = semantic.evidence;
    } catch {
      return null;
    }
    const semantic = validateCanonicalEvidence(evidence, this.config, args.runId, Number(args.anchoredAt));
    if (!semantic) return null;
    const evidenceSemanticsMatch = semantic.match;
    const canonicalJcsMatch = toJcs(evidence) === canonical;
    const evidenceHash = sha256(canonical);
    const manifestHash = hashJcs(manifestSigningBody(evidence.manifest));
    const inputHash = hashJcs(evidence.hash_material.inputs);
    const resultHash = hashJcs(evidence.hash_material.normalized_comparisons);
    const evidenceHashMatch = evidenceHash === args.evidenceHash;
    const manifestHashMatch = manifestHash === args.manifestHash;
    const inputHashMatch = inputHash === args.inputHash;
    const resultHashMatch = resultHash === args.normalizedResultHash;
    const providerSignatureMatch = await declarationMatches(evidence, manifestHash, args);
    const recomputedStatus = passportStatus(evidence.gates, evidence.passport_status !== "not-rehearsable");
    const gateStatusMatch = gateBitmap(evidence.gates) === args.gateBitmap &&
      evidence.passport_status === recomputedStatus &&
      contractStatus(recomputedStatus) === args.status;
    const expectedPreviousRun = evidence.previous_run_id ? evidence.previous_run_id.toLowerCase() : zeroHash;
    const linkFieldsMatch =
      evidence.run_id.toLowerCase() === args.runId.toLowerCase() &&
      sha256(evidence.source_revision) === args.sourceRevisionHash &&
      hashJcs(evidence.payments.launchproof) === args.paymentReceiptHash &&
      expectedPreviousRun === args.previousRunId.toLowerCase() &&
      evidence.provider_declaration.provider_address.toLowerCase() === args.provider.toLowerCase() &&
      (evidence.label === "fixture") === args.isFixture;
    const storageMatch = chainRecordMatchesEvent(stored, args);
    const launchPaymentTransferMatch = await paymentTransferMatches(
      client,
      evidence.payments.launchproof,
      log.blockNumber,
      preserveOperationalErrors,
    );
    const targetPaymentTransferMatch = evidence.payments.target
      ? await paymentTransferMatches(client, evidence.payments.target, log.blockNumber, preserveOperationalErrors)
      : null;
    const transfersMatch = launchPaymentTransferMatch && targetPaymentTransferMatch !== false;
    const match = canonicalJcsMatch && evidenceHashMatch && manifestHashMatch && inputHashMatch &&
      resultHashMatch && providerSignatureMatch && gateStatusMatch && storageMatch &&
      linkFieldsMatch && evidenceSemanticsMatch && transfersMatch && registryRuntimeMatch;
    const record = recordFromChain(
      evidence,
      canonical,
      args,
      this.config.REGISTRY_ADDRESS,
      log.transactionHash,
      log.blockNumber,
      this.config.chain.explorerUrl,
    );
    return {
      record,
      evidence,
      canonical,
      args,
      transactionHash: log.transactionHash,
      blockNumber: log.blockNumber,
      evidenceHashMatch,
      canonicalJcsMatch,
      manifestHashMatch,
      inputHashMatch,
      resultHashMatch,
      providerSignatureMatch,
      gateStatusMatch,
      storageMatch,
      linkFieldsMatch,
      evidenceSemanticsMatch,
      launchPaymentTransferMatch,
      targetPaymentTransferMatch,
      registryRuntimeMatch,
      match,
    };
  }

  /** Locate an unknown run without replaying registry history: binary-search its immutable block timestamp. */
  private async logsAtAnchoredTimestamp(
    client: PublicClient,
    runId: `0x${string}`,
    anchoredAt: bigint,
  ): Promise<any[]> {
    const latest = await client.getBlockNumber();
    const start = await this.firstBlockAtOrAfter(client, anchoredAt, latest);
    if (start > latest) return [];
    const startBlock = await client.getBlock({ blockNumber: start });
    if (startBlock.timestamp !== anchoredAt) return [];
    const after = await this.firstBlockAtOrAfter(client, anchoredAt + 1n, latest);
    const end = after > latest ? latest : after - 1n;
    return client.getLogs({
      address: this.config.REGISTRY_ADDRESS as `0x${string}`,
      event: registryAbi[2],
      args: { runId },
      fromBlock: start,
      toBlock: end,
      strict: true,
    });
  }

  private async firstBlockAtOrAfter(client: PublicClient, timestamp: bigint, latest: bigint): Promise<bigint> {
    let low = this.config.REGISTRY_DEPLOYMENT_BLOCK;
    let high = latest + 1n;
    while (low < high) {
      const middle = low + (high - low) / 2n;
      const block = await client.getBlock({ blockNumber: middle });
      if (block.timestamp < timestamp) low = middle + 1n;
      else high = middle;
    }
    return low;
  }

  private async logsFromReceipt(client: PublicClient, transactionHash: `0x${string}`, runId: `0x${string}`): Promise<any[]> {
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== "success") return [];
    return receipt.logs.filter((log) => {
      if (log.address.toLowerCase() !== this.config.REGISTRY_ADDRESS?.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: registryAbi, data: log.data, topics: log.topics, strict: true });
        return decoded.eventName === "RunPublished" &&
          String((decoded.args as { runId?: unknown }).runId).toLowerCase() === runId.toLowerCase();
      } catch {
        return false;
      }
    });
  }

  private async getLogsChunked(
    client: PublicClient,
    options: {
      address: `0x${string}`;
      event: any;
      args?: any;
      fromBlock: bigint;
      toBlock: bigint | "latest";
      strict?: boolean;
    }
  ): Promise<any[]> {
    const toBlock = options.toBlock === "latest" ? await client.getBlockNumber() : options.toBlock;
    const fromBlock = options.fromBlock;
    if (fromBlock > toBlock) return [];

    const chunkSize = 100n;
    const ranges: { from: bigint; to: bigint }[] = [];
    for (let start = fromBlock; start <= toBlock; start += chunkSize) {
      const end = start + chunkSize - 1n > toBlock ? toBlock : start + chunkSize - 1n;
      ranges.push({ from: start, to: end });
    }

    const limit = pLimit(10);
    const tasks = ranges.map((range) =>
      limit(() =>
        client.getLogs({
          address: options.address,
          event: options.event,
          args: options.args,
          fromBlock: range.from,
          toBlock: range.to,
          strict: options.strict,
        })
      )
    );

    const results = await Promise.all(tasks);
    return results.flat();
  }
}

function chainReferenceFromLoaded(loaded: LoadedChainRun, registryAddress: string, explorerUrl: string): ChainReference {
  return {
    registry_address: registryAddress,
    evidence_transaction_hash: loaded.transactionHash,
    block_number: loaded.blockNumber?.toString() ?? "0",
    explorer_url: `${explorerUrl}/tx/${loaded.transactionHash}`,
    published: true,
  };
}

function pendingChainReference(config: Config, transactionHash: `0x${string}`): ChainReference {
  return {
    registry_address: config.REGISTRY_ADDRESS ?? zeroAddress,
    evidence_transaction_hash: transactionHash,
    block_number: "0",
    explorer_url: `${config.chain.explorerUrl}/tx/${transactionHash}`,
    published: false,
  };
}

async function finalizeReconciledRun(repository: Repository, record: RunRecord): Promise<void> {
  await repository.savePayment(record.payment, record.run_id);
  if (record.target_payment) await repository.savePayment(record.target_payment, record.run_id);
  await repository.saveRun(record);
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

function cacheMatchesLoaded(cache: RunRecord, loaded: LoadedChainRun): boolean {
  return cache.run_id.toLowerCase() === loaded.args.runId.toLowerCase() &&
    cache.canonical_evidence_jcs === loaded.canonical &&
    cache.evidence_hash.toLowerCase() === loaded.args.evidenceHash.toLowerCase() &&
    cache.manifest_hash.toLowerCase() === loaded.args.manifestHash.toLowerCase() &&
    cache.input_hash.toLowerCase() === loaded.args.inputHash.toLowerCase() &&
    cache.normalized_result_hash.toLowerCase() === loaded.args.normalizedResultHash.toLowerCase() &&
    cache.source_version_sha.toLowerCase() === loaded.evidence.source_revision.toLowerCase() &&
    cache.provider_declaration.provider_address.toLowerCase() === loaded.args.provider.toLowerCase() &&
    cache.chain.published &&
    cache.chain.evidence_transaction_hash.toLowerCase() === loaded.transactionHash.toLowerCase();
}

function recordFromChain(
  evidence: CanonicalEvidence,
  canonical: string,
  args: PublishedArgs,
  registryAddress: string,
  transactionHash: `0x${string}`,
  blockNumber: bigint | null,
  explorerUrl: string,
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
      explorer_url: `${explorerUrl}/tx/${transactionHash}`,
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
    operation: record.previous_run_id ? "renewal" : "genesis",
    previous_run_id: record.previous_run_id,
    payment: record.payment,
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
    canonical_jcs_match: false,
    manifest_hash_match: false,
    input_hash_match: false,
    result_hash_match: false,
    provider_signature_match: false,
    gate_status_match: false,
    storage_match: false,
    link_fields_match: false,
    evidence_semantics_match: false,
    launch_payment_transfer_match: false,
    target_payment_transfer_match: null,
    registry_runtime_match: false,
    cache_match: null,
    match: false,
    transaction_hash: null,
    block_number: null,
    anchored_at: null,
    canonical_evidence: null,
  };
}

const transferEvent = [{
  type: "event",
  name: "Transfer",
  inputs: [
    { name: "from", type: "address", indexed: true },
    { name: "to", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
  ],
}] as const;

async function paymentTransferMatches(
  client: PublicClient,
  payment: PaymentReference,
  publicationBlock: bigint | null,
  preserveOperationalErrors = false,
): Promise<boolean> {
  if (
    payment.status !== "settled" ||
    !payment.settlement_transaction ||
    !payment.payer ||
    !payment.recipient ||
    payment.payment_id.toLowerCase() !== payment.settlement_transaction.toLowerCase() ||
    payment.amount !== payment.amount_atomic
  ) return false;
  try {
    const receipt = await client.getTransactionReceipt({
      hash: payment.settlement_transaction as `0x${string}`,
    });
    if (receipt.status !== "success" || (publicationBlock !== null && receipt.blockNumber > publicationBlock)) {
      return false;
    }
    const amount = BigInt(payment.amount_atomic);
    const transferMatches = receipt.logs.some((log) => {
      if (log.address.toLowerCase() !== payment.asset.toLowerCase()) return false;
      try {
        const decoded = decodeEventLog({ abi: transferEvent, data: log.data, topics: log.topics, strict: true });
        const transfer = decoded.args as { from: string; to: string; value: bigint };
        return transfer.from.toLowerCase() === payment.payer!.toLowerCase() &&
          transfer.to.toLowerCase() === payment.recipient!.toLowerCase() &&
          transfer.value === amount;
      } catch {
        return false;
      }
    });
    if (!transferMatches) return false;
    const block = await client.getBlock({ blockNumber: receipt.blockNumber });
    return new Date(Number(block.timestamp) * 1_000).toISOString() === payment.timestamp;
  } catch (error) {
    if (preserveOperationalErrors && !isMissingTransactionReceipt(error)) throw error;
    return false;
  }
}

function isMissingTransactionReceipt(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TransactionReceiptNotFoundError" || /transaction receipt.*not found/i.test(error.message);
}
