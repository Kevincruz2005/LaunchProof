import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import request from "supertest";
import { describe, expect, it } from "vitest";
import {
  evaluatePassportGate,
  makeContractIdentity,
  type CurrentLaunchContractProof,
  type PassportGateConfig,
  type PassportGateRequest,
  type PassportGateResult,
  type PassportProof,
  type SettlementProof,
} from "@launchproof/passport-gate";
import { loadConfig } from "../src/config.js";
import type { RegistryVerification } from "../src/chain/registry.js";
import { MemoryRepository } from "../src/db/store.js";
import type { RunRecord } from "../src/domain/types.js";
import { hashJcs } from "../src/evidence/canonical.js";
import { manifestSigningBody, type LaunchContract } from "../src/launch-contract/schema.js";
import { PassportGateService, type PassportGateAdapter } from "../src/passport-gate/service.js";
import { createApp } from "../src/rest/app.js";

const PROVIDER = "0x1111111111111111111111111111111111111111";
const PAYER = "0x2222222222222222222222222222222222222222";
const RECIPIENT = "0x3333333333333333333333333333333333333333";
const ASSET = "0x4444444444444444444444444444444444444444";
const SOURCE = "a".repeat(40);
const MANIFEST_HASH = `0x${"b".repeat(64)}` as const;
const OBSERVED_AT = "2026-07-20T12:00:00.000Z";
const API_PATH = "/api/v1/passport-gate/check";

const appConfig = loadConfig({
  NODE_ENV: "test",
  PUBLIC_API_BASE_URL: "http://localhost:4000",
  PUBLIC_WEB_BASE_URL: "http://localhost:3000",
  BUILD_COMMIT_SHA: "adapter-test",
  ALLOW_LOCAL_UNPAID_RUNS: "false",
  FREE_RATE_LIMIT_PER_MINUTE: "1000",
});

const gateConfig: PassportGateConfig = {
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

class ControlledEvidenceAdapter implements PassportGateAdapter {
  readonly calls: PassportGateRequest[] = [];

  async check(input: PassportGateRequest): Promise<PassportGateResult> {
    this.calls.push(structuredClone(input));
    const url = input.launch_contract_url;
    const current = currentContract(url);
    if (url.includes("unavailable")) {
      return evaluatePassportGate({
        request: input,
        config: gateConfig,
        observedAt: OBSERVED_AT,
        operationalFailure: { code: "RPC_TIMEOUT", explanation: "Controlled RPC timeout." },
      });
    }
    if (url.includes("no-passport")) {
      return evaluatePassportGate({ request: input, config: gateConfig, observedAt: OBSERVED_AT, currentContract: current, newestRelevantPassport: null });
    }
    const age = url.includes("warning") ? 48 : 2;
    const proof = passport(url, age);
    if (url.includes("invalid-output")) {
      proof.gates.fresh_challenge = false;
      proof.status = "NeedsAttention";
    }
    if (url.includes("schema-drift")) {
      proof.gates.contract_correct = false;
      proof.status = "NeedsAttention";
    }
    if (url.includes("timeout")) {
      proof.gates.safe_to_rehearse = false;
      proof.status = "NeedsAttention";
    }
    return evaluatePassportGate({
      request: input,
      config: gateConfig,
      observedAt: OBSERVED_AT,
      currentContract: current,
      newestRelevantPassport: proof,
    });
  }
}

function currentContract(url: string): CurrentLaunchContractProof {
  return {
    launchContractUrl: url,
    manifestHash: MANIFEST_HASH,
    providerAddress: PROVIDER,
    sourceRevision: SOURCE,
    schemaValid: true,
    signatureValid: true,
    manifestHashValid: true,
    safeFetchVerified: true,
  };
}

function passport(url: string, ageHours: number): PassportProof {
  return {
    runId: `0x${"1".repeat(64)}`,
    status: "Verified",
    identity: makeContractIdentity(currentContract(url)),
    anchoredBlockTimestamp: new Date(Date.parse(OBSERVED_AT) - ageHours * 3_600_000).toISOString(),
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
    inboundSettlement: settlement("2"),
    providerSettlement: settlement("3"),
    publicationTransactionHash: `0x${"4".repeat(64)}`,
    evidenceHash: `0x${"5".repeat(64)}`,
    manifestHash: MANIFEST_HASH,
    inputHash: `0x${"6".repeat(64)}`,
    resultHash: `0x${"7".repeat(64)}`,
  };
}

function settlement(hashDigit: string): SettlementProof {
  const reference = {
    paymentId: `0x${hashDigit.repeat(64)}`,
    network: "eip155:1952",
    asset: ASSET,
    amountAtomic: "10000",
    assetDecimals: 6,
    payer: PAYER,
    recipient: RECIPIENT,
    transactionHash: `0x${hashDigit.repeat(64)}` as `0x${string}`,
    blockTimestamp: "2026-07-20T09:00:00.000Z",
  } as const;
  return { expected: reference, reference: { ...reference }, present: true, receiptSuccess: true, independentlyVerified: true };
}

async function mcpCall(app: ReturnType<typeof createApp>, input: unknown) {
  return request(app)
    .post("/mcp/public")
    .set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "check_service_passport", arguments: input } });
}

function mcpContent(response: Awaited<ReturnType<typeof mcpCall>>): Record<string, unknown> {
  return JSON.parse(response.body.result.content[0].text) as Record<string, unknown>;
}

describe("PassportGate REST and MCP/A2MCP contracts", () => {
  it("maps controlled read-only index and registry reconstruction through the real PassportGate service", async () => {
    const url = "https://healthy-service.example.com/launch-contract.json";
    const manifest = controlledManifest(url);
    const record = controlledRun(url, manifest);
    class IndexedRepository extends MemoryRepository {
      override async passportsForTarget(target: string, provider: string): Promise<RunRecord[]> {
        expect(target).toBe(url);
        expect(provider.toLowerCase()).toBe(PROVIDER.toLowerCase());
        return [record];
      }
    }
    const registry = {
      assertVerificationAvailable: async () => undefined,
      verifyStrict: async (): Promise<RegistryVerification> => controlledVerification(record),
    };
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_API_BASE_URL: "http://localhost:4000",
      PUBLIC_WEB_BASE_URL: "http://localhost:3000",
      BUILD_COMMIT_SHA: SOURCE,
      XLAYER_RPC_URL: "https://rpc.example.com",
      REGISTRY_ADDRESS: "0x5555555555555555555555555555555555555555",
      REGISTRY_DEPLOYMENT_BLOCK: "1",
      REGISTRY_RUNTIME_CODE_HASH: `0x${"8".repeat(64)}`,
      REGISTRY_WRITER_PRIVATE_KEY: `0x${"9".repeat(64)}`,
      PAYOUT_ADDRESS: RECIPIENT,
    });
    const service = new PassportGateService(
      config,
      new IndexedRepository(),
      registry as never,
      {
        now: () => new Date(OBSERVED_AT),
        loadCurrentContract: async () => ({
          manifest,
          currentContract: {
            launchContractUrl: url,
            manifestHash: hashJcs(manifestSigningBody(manifest)),
            providerAddress: PROVIDER,
            sourceRevision: SOURCE,
            schemaValid: true,
            signatureValid: true,
            manifestHashValid: true,
            safeFetchVerified: true,
          },
        }),
      },
    );
    await expect(service.check({ launch_contract_url: url })).resolves.toMatchObject({
      operational_status: "AVAILABLE",
      decision: "ALLOW",
      reason_codes: ["PASSPORT_VALID"],
      independent_verification: true,
      database_chain_match: true,
    });
  });

  it("keeps a real service registry timeout operational and never consults cache as proof", async () => {
    const url = "https://healthy-service.example.com/launch-contract.json";
    const manifest = controlledManifest(url);
    class GuardedRepository extends MemoryRepository {
      override async passportsForTarget(): Promise<RunRecord[]> {
        throw new Error("cache must not be consulted after registry preflight fails");
      }
    }
    const config = loadConfig({
      NODE_ENV: "test",
      PUBLIC_API_BASE_URL: "http://localhost:4000",
      PUBLIC_WEB_BASE_URL: "http://localhost:3000",
      BUILD_COMMIT_SHA: SOURCE,
      XLAYER_RPC_URL: "https://rpc.example.com",
      REGISTRY_ADDRESS: "0x5555555555555555555555555555555555555555",
      REGISTRY_DEPLOYMENT_BLOCK: "1",
      REGISTRY_RUNTIME_CODE_HASH: `0x${"8".repeat(64)}`,
      REGISTRY_WRITER_PRIVATE_KEY: `0x${"9".repeat(64)}`,
    });
    const service = new PassportGateService(
      config,
      new GuardedRepository(),
      { assertVerificationAvailable: async () => { throw new Error("RPC request timed out"); } } as never,
      {
        now: () => new Date(OBSERVED_AT),
        loadCurrentContract: async () => ({
          manifest,
          currentContract: {
            launchContractUrl: url,
            manifestHash: hashJcs(manifestSigningBody(manifest)),
            providerAddress: PROVIDER,
            sourceRevision: SOURCE,
            schemaValid: true,
            signatureValid: true,
            manifestHashValid: true,
            safeFetchVerified: true,
          },
        }),
      },
    );
    await expect(service.check({ launch_contract_url: url })).resolves.toMatchObject({
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["RPC_TIMEOUT"],
    });
  });

  it.each([
    ["healthy", "ALLOW"],
    ["warning", "WARN"],
    ["no-passport", "REHEARSAL_REQUIRED"],
    ["invalid-output", "BLOCK"],
  ] as const)("returns semantically identical %s decisions through REST and MCP", async (variant, expected) => {
    const adapter = new ControlledEvidenceAdapter();
    const app = createApp(appConfig, undefined, { passportGate: adapter });
    const input = { launch_contract_url: `https://${variant}.example.com/launch-contract.json` };
    const [rest, mcp] = await Promise.all([request(app).post(API_PATH).send(input), mcpCall(app, input)]);
    expect(rest.status).toBe(200);
    expect(mcp.status).toBe(200);
    expect(rest.body.decision).toBe(expected);
    expect(mcp.body.result.isError, JSON.stringify(mcp.body)).not.toBe(true);
    expect(mcpContent(mcp)).toEqual(rest.body);
    expect(mcp.body.result.structuredContent).toEqual(rest.body);
  });

  it("exposes equivalent retry-safe unavailability with no trust decision", async () => {
    const adapter = new ControlledEvidenceAdapter();
    const app = createApp(appConfig, undefined, { passportGate: adapter });
    const input = { launch_contract_url: "https://unavailable.example.com/launch-contract.json" };
    const [rest, mcp] = await Promise.all([request(app).post(API_PATH).send(input), mcpCall(app, input)]);
    expect(rest.status).toBe(503);
    expect(rest.body).toMatchObject({
      error: "verification_unavailable",
      retry_safe: true,
      operational_status: "UNAVAILABLE",
      decision: null,
      reason_codes: ["RPC_TIMEOUT"],
    });
    expect(mcp.body.result.isError).toBe(true);
    expect(mcpContent(mcp)).toEqual(rest.body);
    expect(mcp.body.result.structuredContent).toEqual(rest.body);
  });

  it.each([
    { launch_contract_url: "http://private.example.com/contract.json" },
    { launch_contract_url: "https://healthy.example.com/contract.json", warn_age_hours: 72, max_age_hours: 24 },
    { launch_contract_url: "https://healthy.example.com/contract.json", expected_provider_address: "0x123" },
    { launch_contract_url: "https://healthy.example.com/contract.json", unexpected: true },
  ])("validates REST and MCP input identically: %j", async (input) => {
    const app = createApp(appConfig, undefined, { passportGate: new ControlledEvidenceAdapter() });
    const [rest, mcp] = await Promise.all([request(app).post(API_PATH).send(input), mcpCall(app, input)]);
    expect(rest.status).toBe(400);
    expect(mcp.status).toBe(200);
    expect(Boolean(mcp.body.error) || mcp.body.result?.isError === true).toBe(true);
  });

  it.each([
    ["healthy", "ALLOW", "PASSPORT_VALID"],
    ["invalid-output", "BLOCK", "GATE_FRESH_CHALLENGE_FAILED"],
    ["schema-drift", "BLOCK", "GATE_CONTRACT_CORRECT_FAILED"],
    ["timeout", "BLOCK", "GATE_SAFE_TO_REHEARSE_FAILED"],
  ] as const)("classifies the controlled %s fixture without payment or a chain write", async (variant, expectedDecision, reason) => {
    const adapter = new ControlledEvidenceAdapter();
    const app = createApp(appConfig, undefined, { passportGate: adapter });
    const response = await request(app).post(API_PATH).send({
      launch_contract_url: `https://${variant}.example.com/launch-contract.json`,
    });
    expect(response.body.decision).toBe(expectedDecision);
    expect(response.body.reason_codes).toContain(reason);
    expect(response.body.rehearsal_action).toBeNull();
    expect(adapter.calls).toHaveLength(1);
  });

  it("documents and advertises the versioned REST route and MCP tool additively", async () => {
    const app = createApp(appConfig, undefined, { passportGate: new ControlledEvidenceAdapter() });
    const [card, openapi, schema, tools] = await Promise.all([
      request(app).get("/.well-known/launchproof.json"),
      request(app).get("/schema/openapi.json"),
      request(app).get("/schema/passport-gate.schema.json"),
      request(app).post("/mcp/public").set("Accept", "application/json, text/event-stream")
        .send({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
    ]);
    expect(card.body).toEqual(expect.objectContaining({
      name: "LaunchProof",
      mcp_endpoint: expect.any(String),
      public_mcp_endpoint: expect.any(String),
      rest_endpoint: expect.any(String),
      passport_gate_rest_endpoint: expect.stringContaining(API_PATH),
    }));
    expect(card.body.public_tools).toEqual(expect.arrayContaining(["get_service_passport", "check_service_passport"]));
    expect(openapi.body.paths[API_PATH]).toBeTruthy();
    expect(openapi.body.paths["/api/rehearsals"]).toBeTruthy();
    expect(schema.status).toBe(200);
    const listed = tools.body.result.tools.find((tool: { name: string }) => tool.name === "check_service_passport");
    expect(listed.inputSchema).toMatchObject({
      type: "object",
      required: ["launch_contract_url"],
      properties: { launch_contract_url: { type: "string" } },
    });
    expect(listed.outputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["operational_status", "decision", "reason_codes", "observed_at"]),
      properties: { rehearsal_action: expect.any(Object), database_chain_match: expect.any(Object) },
    });
  });

  it("validates representative REST/MCP results against the published JSON Schema", async () => {
    const schemaPath = fileURLToPath(new URL("../../schema/passport-gate.schema.json", import.meta.url));
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
    const ajv = new Ajv2020({ strict: true, allErrors: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    const adapter = new ControlledEvidenceAdapter();
    const app = createApp(appConfig, undefined, { passportGate: adapter });
    const available = await request(app).post(API_PATH).send({ launch_contract_url: "https://healthy.example.com/launch-contract.json" });
    const unavailable = await request(app).post(API_PATH).send({ launch_contract_url: "https://unavailable.example.com/launch-contract.json" });
    expect(validate(available.body), JSON.stringify(validate.errors)).toBe(true);
    expect(validate(unavailable.body), JSON.stringify(validate.errors)).toBe(true);
  });

  it("keeps the existing paid rehearsal route and response fields backward compatible", async () => {
    const app = createApp(appConfig, undefined, { passportGate: new ControlledEvidenceAdapter() });
    const response = await request(app).post("/api/rehearsals").send({
      url: "https://example.com",
      idempotency_key: "phase2-backward-compatible",
    });
    expect(response.status).toBe(402);
    expect(response.body).toEqual(expect.objectContaining({
      error: "payment_required",
      local_only: true,
      detail: expect.any(String),
    }));
  });
});

function controlledManifest(url: string): LaunchContract {
  return {
    contract_version: "1.0",
    service_name: "Controlled healthy fixture",
    mcp_endpoint: "https://healthy-service.example.com/mcp",
    tool: "normalize_invoice",
    mode: "sample_only",
    sample_input: { invoice_text: "sample" },
    assertions: [{ path: "$.document_id", rule: "equals", value: "LP-1" }],
    max_latency_ms: 2_000,
    delivery_type: "synchronous_json",
    payment_mode: "x402_optional",
    payment: {
      network: "eip155:1952",
      asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
      amount: "10000",
      recipient: RECIPIENT,
      resource_url: "https://healthy-service.example.com/paid",
    },
    safe_use: ["read-only synthetic sample", "no credentials or account", "no external side effects"],
    source_revision: SOURCE,
    challenge_profile: {
      name: "structured-extraction-v1",
      tool: "normalize_invoice",
      input_field: "document_text",
      output_fields: ["document_id", "currency", "total", "due_date"],
      challenge_runs: 3,
      max_latency_ms_per_run: 2_000,
      safe_mode: "synthetic_read_only",
    },
    provider_address: PROVIDER,
  };
}

function controlledRun(url: string, manifest: LaunchContract): RunRecord {
  const inbound = controlledPayment("launchproof", "a", RECIPIENT, "/api/rehearsals");
  const target = controlledPayment("target", "b", RECIPIENT, manifest.payment!.resource_url);
  const evidence = {
    run_id: `0x${"1".repeat(64)}`,
    target: url,
    manifest,
    source_revision: SOURCE,
    provider_declaration: { provider_address: PROVIDER, manifest_hash: hashJcs(manifestSigningBody(manifest)) },
    previous_run_id: null,
    passport_status: "verified",
    gates: { discoverable: "pass", contract_correct: "pass", fresh_challenge: "pass", safe_to_rehearse: "pass", paid_delivery: "pass" },
    payments: { launchproof: inbound, target },
    hash_material: { inputs: [], normalized_comparisons: [] },
  } as unknown as RunRecord["canonical_evidence"];
  return {
    run_id: evidence.run_id,
    idempotency_key: "controlled-index-record",
    state: "complete",
    previous_run_id: null,
    label: "fixture",
    scope: "structured-extraction-v1 only",
    passport_status: "verified",
    gates: evidence.gates,
    canonical_evidence: evidence,
    canonical_evidence_jcs: JSON.stringify(evidence),
    evidence_hash: `0x${"5".repeat(64)}`,
    manifest_hash: hashJcs(manifestSigningBody(manifest)),
    input_hash: hashJcs([]),
    normalized_result_hash: hashJcs([]),
    source_version_sha: SOURCE,
    build_commit_sha: SOURCE,
    generated_at: "2026-07-20T09:30:00.000Z",
    provider_declaration: {
      provider_address: PROVIDER,
      manifest_hash: hashJcs(manifestSigningBody(manifest)),
      signature: null,
      verification_state: "verified",
    },
    payment: inbound,
    target_payment: target,
    chain: {
      registry_address: "0x5555555555555555555555555555555555555555",
      evidence_transaction_hash: `0x${"4".repeat(64)}`,
      block_number: "100",
      explorer_url: `https://explorer.example.com/tx/0x${"4".repeat(64)}`,
      published: true,
    },
    remediation: [],
    limitations: [],
  };
}

function controlledPayment(kind: "launchproof" | "target", digit: string, recipient: string, route: string) {
  return {
    payment_id: `0x${digit.repeat(64)}`,
    kind,
    amount: "10000",
    amount_atomic: "10000",
    amount_display: "0.01",
    asset_decimals: 6,
    asset: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
    network: "eip155:1952",
    payer: PAYER,
    recipient,
    route,
    settlement_transaction: `0x${digit.repeat(64)}`,
    status: "settled",
    timestamp: "2026-07-20T09:00:00.000Z",
  } as const;
}

function controlledVerification(record: RunRecord): RegistryVerification {
  return {
    chain_record_found: true,
    evidence_hash_match: true,
    canonical_jcs_match: true,
    manifest_hash_match: true,
    input_hash_match: true,
    result_hash_match: true,
    provider_signature_match: true,
    gate_status_match: true,
    storage_match: true,
    link_fields_match: true,
    evidence_semantics_match: true,
    launch_payment_transfer_match: true,
    target_payment_transfer_match: true,
    registry_runtime_match: true,
    cache_match: true,
    match: true,
    transaction_hash: record.chain.evidence_transaction_hash as `0x${string}`,
    block_number: record.chain.block_number,
    anchored_at: "2026-07-20T10:00:00.000Z",
    canonical_evidence: record.canonical_evidence,
  };
}
