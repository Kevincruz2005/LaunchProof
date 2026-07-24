import { describe, expect, it, vi } from "vitest";
import { loadConfig } from "../src/config.js";
import { RegistryService } from "../src/chain/registry.js";
import { MemoryRepository } from "../src/db/store.js";
import { RehearsalService } from "../src/workers/rehearsal.js";
import type { PaymentReference, RunRecord } from "../src/domain/types.js";

const evidenceHash = `0x${"a1".repeat(32)}` as const;
const manifestHash = `0x${"a2".repeat(32)}` as const;
const inputHash = `0x${"a3".repeat(32)}` as const;
const resultHash = `0x${"a4".repeat(32)}` as const;
const publicationTransaction = `0x${"b1".repeat(32)}` as const;
const registryAddress = `0x${"12".repeat(20)}` as const;

describe("crash and restart reconciliation", () => {
  it("finalizes the exact on-chain candidate after a crash between publication and database save", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      BUILD_COMMIT_SHA: "a".repeat(40),
      XLAYER_RPC_URL: "https://rpc.example",
      REGISTRY_ADDRESS: registryAddress,
      REGISTRY_DEPLOYMENT_BLOCK: "1",
      REGISTRY_RUNTIME_CODE_HASH: `0x${"c1".repeat(32)}`,
      REGISTRY_WRITER_PRIVATE_KEY: `0x${"d1".repeat(32)}`,
    });
    const repository = new MemoryRepository();
    const reservationService = new RehearsalService(config, repository);
    const progress = await reservationService.reserve("https://fixture.example", "publication-crash-recovery");
    const payment: PaymentReference = {
      payment_id: `0x${"e1".repeat(32)}`,
      kind: "launchproof",
      amount: "10000",
      amount_atomic: "10000",
      amount_display: "0.01",
      asset_decimals: 6,
      asset: config.chain.usdt0Address,
      network: config.chain.network,
      payer: `0x${"34".repeat(20)}`,
      recipient: `0x${"56".repeat(20)}`,
      route: "/api/rehearsals",
      settlement_transaction: `0x${"e1".repeat(32)}`,
      status: "settled",
      timestamp: "2026-07-20T00:00:00.000Z",
    };
    const pendingCandidate = candidate(progress.run_id, progress.idempotency_key, payment, false);
    await repository.recordPublicationAttempt(progress.run_id, {
      transaction_hash: publicationTransaction,
      evidence_hash: evidenceHash,
      started_at: "2026-07-20T00:00:01.000Z",
      candidate: pendingCandidate,
    });

    // A new service instance represents process restart. Its chain loader is
    // mocked at the RPC boundary, while the real reconciliation and repository
    // finalization code executes unchanged.
    const restarted = new RegistryService(config);
    const publishedRecord = candidate(progress.run_id, progress.idempotency_key, payment, true);
    const internal = restarted as unknown as { load: (...args: unknown[]) => Promise<unknown> };
    vi.spyOn(internal, "load").mockResolvedValue({
      match: true,
      args: { evidenceHash },
      canonical: publishedRecord.canonical_evidence_jcs,
      record: publishedRecord,
    });

    await expect(restarted.reconcilePendingPublications(repository)).resolves.toBe(1);
    const restored = await repository.getRun(progress.run_id);
    expect(restored).toEqual(publishedRecord);
    expect(await repository.pendingPublications()).toEqual([]);
    expect(await repository.getPayment(payment.payment_id)).toEqual({ ...payment, run_id: progress.run_id });
    await expect(restarted.reconcilePendingPublications(repository)).resolves.toBe(0);
  });
});

function candidate(runId: string, idempotencyKey: string, payment: PaymentReference, published: boolean): RunRecord {
  const canonical = '{"schema_version":"1.0","test":"publication-recovery"}';
  return {
    run_id: runId,
    idempotency_key: idempotencyKey,
    state: published ? "complete" : "publishing_on_chain",
    previous_run_id: null,
    label: "external",
    scope: "structured-extraction-v1 only",
    passport_status: "verified",
    gates: {
      discoverable: "pass",
      contract_correct: "pass",
      fresh_challenge: "pass",
      safe_to_rehearse: "pass",
      paid_delivery: "pass",
    },
    canonical_evidence: { schema_version: "1.0" } as RunRecord["canonical_evidence"],
    canonical_evidence_jcs: canonical,
    evidence_hash: evidenceHash,
    manifest_hash: manifestHash,
    input_hash: inputHash,
    normalized_result_hash: resultHash,
    source_version_sha: "f".repeat(40),
    build_commit_sha: "a".repeat(40),
    generated_at: "2026-07-20T00:00:00.000Z",
    provider_declaration: {
      provider_address: `0x${"78".repeat(20)}`,
      manifest_hash: manifestHash,
      signature: null,
      verification_state: "verified",
    },
    payment,
    target_payment: null,
    chain: {
      registry_address: registryAddress,
      evidence_transaction_hash: publicationTransaction,
      block_number: published ? "100" : "0",
      explorer_url: `https://www.okx.com/explorer/xlayer-test/tx/${publicationTransaction}`,
      published,
    },
    remediation: [],
    limitations: [],
  };
}
