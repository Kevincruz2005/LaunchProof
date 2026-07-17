import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/db/store.js";
import type { PaymentReference } from "../src/domain/types.js";
import { RehearsalService } from "../src/workers/rehearsal.js";

const buildCommit = "a".repeat(40);
const provider = `0x${"12".repeat(20)}`;
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/.well-known/launch-contract.json") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(manifest()));
      return;
    }
    if (request.method !== "POST" || request.url !== "/mcp") {
      response.statusCode = 404;
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const rpc = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
      id?: unknown;
      method?: string;
      params?: { arguments?: Record<string, unknown> };
    };
    response.setHeader("content-type", "application/json");
    if (rpc.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (rpc.method === "initialize") return send(response, rpc.id, {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "healthy-test", version: "1", api_key: "must-not-persist" },
    });
    if (rpc.method === "tools/list") return send(response, rpc.id, {
      tools: [{
        name: "normalize_invoice",
        description: "Bounded synthetic invoice parser",
        inputSchema: {
          type: "object",
          properties: {
            invoice_text: { type: "string", maxLength: 1_000 },
            document_text: { type: "string", maxLength: 1_000 },
          },
          anyOf: [{ required: ["invoice_text"] }, { required: ["document_text"] }],
          additionalProperties: false,
        },
      }],
    });
    const args = rpc.params?.arguments ?? {};
    const text = typeof args.invoice_text === "string"
      ? args.invoice_text
      : typeof args.document_text === "string" ? args.document_text : null;
    if (!text) return send(response, rpc.id, {
      content: [{ type: "text", text: "INVALID_INPUT: bounded invoice text is required" }],
      isError: true,
    });
    return send(response, rpc.id, {
      structuredContent: normalize(text),
      content: [{ type: "text", text: JSON.stringify(normalize(text)) }],
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

describe("rehearsal worker", () => {
  it("runs the real manifest/MCP path and derives truthful gates", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      BUILD_COMMIT_SHA: buildCommit,
      PUBLIC_API_BASE_URL: "http://localhost:4000",
      ALLOW_LOCAL_UNPAID_RUNS: "true",
      ALLOW_PRIVATE_TARGETS: "true",
    });
    const repository = new MemoryRepository();
    const service = new RehearsalService(config, repository);
    const payment = localPayment(config, "local-worker-test");
    const run = await service.start({ url: baseUrl, idempotency_key: "worker-healthy-test", payment }, true);
    expect("canonical_evidence" in run).toBe(true);
    if (!("canonical_evidence" in run)) return;
    expect(run.gates).toEqual({
      discoverable: "pass",
      contract_correct: "pass",
      fresh_challenge: "pass",
      safe_to_rehearse: "pass",
      paid_delivery: "not_tested",
    });
    expect(run.passport_status).toBe("needs-attention");
    expect(run.label).toBe("external");
    expect(run.canonical_evidence.execution_mode).toBe("local");
    expect(JSON.stringify(run.canonical_evidence.discovery)).not.toContain("must-not-persist");
  });

  it("recovers a durably authorized run after a simulated restart", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      BUILD_COMMIT_SHA: buildCommit,
      PUBLIC_API_BASE_URL: "http://localhost:4000",
      ALLOW_LOCAL_UNPAID_RUNS: "true",
      ALLOW_PRIVATE_TARGETS: "true",
    });
    const repository = new MemoryRepository();
    const firstProcess = new RehearsalService(config, repository);
    const reserved = await firstProcess.reserve(baseUrl, "recover-worker-test");
    await repository.authorizeRun(localPayment(config, "local-recovery-payment"), reserved.run_id);

    const restarted = new RehearsalService(config, repository);
    expect(await restarted.recoverPendingRuns()).toBe(1);
    const recovered = await repository.getRun(reserved.run_id);
    expect(recovered && "canonical_evidence" in recovered).toBe(true);
  });

  it("never publishes a local unpaid run even when chain publication is configured", async () => {
    const config = loadConfig({
      NODE_ENV: "test",
      BUILD_COMMIT_SHA: buildCommit,
      PUBLIC_API_BASE_URL: "http://localhost:4000",
      ALLOW_LOCAL_UNPAID_RUNS: "true",
      ALLOW_PRIVATE_TARGETS: "true",
      XLAYER_RPC_URL: "https://rpc.invalid.example",
      REGISTRY_ADDRESS: `0x${"34".repeat(20)}`,
      REGISTRY_DEPLOYMENT_BLOCK: "1",
      REGISTRY_RUNTIME_CODE_HASH: `0x${"56".repeat(32)}`,
      REGISTRY_WRITER_PRIVATE_KEY: `0x${"78".repeat(32)}`,
    });
    const repository = new MemoryRepository();
    const service = new RehearsalService(config, repository);
    const run = await service.start({
      url: baseUrl,
      idempotency_key: "local-chain-configured",
      payment: localPayment(config, "local-chain-payment"),
    }, true);
    expect(run.state).toBe("complete_local");
    if ("canonical_evidence" in run) {
      expect(run.canonical_evidence.execution_mode).toBe("local");
      expect(run.chain.published).toBe(false);
      expect(run.chain.evidence_transaction_hash).toBe(`0x${"00".repeat(32)}`);
    }
  });
});

function localPayment(config: ReturnType<typeof loadConfig>, id: string): PaymentReference {
  return {
    payment_id: id,
    kind: "launchproof",
    amount: "10000",
    amount_atomic: "10000",
    amount_display: "0.01",
    asset_decimals: 6,
    asset: config.chain.usdt0Address,
    network: config.chain.network,
    payer: null,
    recipient: null,
    route: "/api/rehearsals",
    settlement_transaction: null,
    status: "local_only",
    timestamp: "2026-07-16T00:00:00.000Z",
  };
}

function manifest() {
  return {
    contract_version: "1.0",
    service_name: "Healthy invoice fixture",
    mcp_endpoint: `${baseUrl}/mcp`,
    tool: "normalize_invoice",
    mode: "sample_only",
    sample_input: { invoice_text: "Invoice #101, total USD 42.00, due 2026-07-31" },
    assertions: [
      { path: "$.invoice_number", rule: "equals", value: "101" },
      { path: "$.currency", rule: "equals", value: "USD" },
      { path: "$.total", rule: "equals", value: 42 },
      { path: "$.confidence", rule: "gte", value: 0.9 },
    ],
    max_latency_ms: 2_000,
    delivery_type: "synchronous_json",
    payment_mode: "none",
    safe_use: ["read-only synthetic sample data", "no account or credentials", "no external side effect"],
    source_revision: buildCommit,
    challenge_profile: {
      name: "structured-extraction-v1",
      tool: "normalize_invoice",
      input_field: "document_text",
      output_fields: ["document_id", "currency", "total", "due_date"],
      challenge_runs: 3,
      max_latency_ms_per_run: 2_000,
      safe_mode: "synthetic_read_only",
    },
    provider_address: provider,
  };
}

function normalize(text: string): Record<string, unknown> {
  const invoice = text.match(/Invoice\s+#([A-Za-z0-9-]+)/i)?.[1];
  const document = text.match(/Synthetic invoice\s+(LP-[A-F0-9]+)/i)?.[1];
  const currency = text.match(/(?:currency|total)\s+(USD|EUR|GBP|SGD|INR)/i)?.[1] ?? "USD";
  const total = text.match(/total\s+(?:USD|EUR|GBP|SGD|INR)?\s*([0-9]+\.[0-9]{2})/i)?.[1] ?? "0.00";
  const due = text.match(/due\s+(\d{4}-\d{2}-\d{2})/i)?.[1] ?? null;
  return document
    ? { document_id: document, currency, total, due_date: due }
    : { invoice_number: invoice, currency, total: Number(total), confidence: 0.99 };
}

function send(response: import("node:http").ServerResponse, id: unknown, result: Record<string, unknown>): void {
  response.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
}
