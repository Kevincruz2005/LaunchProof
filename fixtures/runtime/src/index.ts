import { createHash } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { canonicalize } from "json-canonicalize";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";

export type FixtureVariant = "healthy" | "invalid-output" | "schema-drift" | "timeout";

const NETWORK = "eip155:196" as const;
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;

interface FixtureConfig {
  variant: FixtureVariant;
  port: number;
  publicBaseUrl: string;
  sourceRevision: string;
  providerKey: `0x${string}`;
  production: boolean;
  x402Enabled: boolean;
  paymentRecipient?: `0x${string}`;
  paymentAmount: string;
  okxApiKey: string | undefined;
  okxSecretKey: string | undefined;
  okxPassphrase: string | undefined;
}

function config(variant: FixtureVariant): FixtureConfig {
  const production = process.env.NODE_ENV === "production";
  const providerKey = process.env.FIXTURE_PROVIDER_PRIVATE_KEY as `0x${string}` | undefined;
  if (production && !providerKey) throw new Error("Production fixture requires FIXTURE_PROVIDER_PRIVATE_KEY");
  const port = Number(process.env.PORT ?? 4100);
  const publicBaseUrl = process.env.PUBLIC_BASE_URL ?? `https://${variant}.fixtures.launchproof.example`;
  if (production && (!process.env.PUBLIC_BASE_URL || !publicBaseUrl.startsWith("https://") || publicBaseUrl.includes(".example"))) {
    throw new Error("Production fixture requires its real public HTTPS base URL");
  }
  const sourceRevision = process.env.SOURCE_REVISION ?? `fixture-${variant}-development`;
  if (production && !/^[0-9a-f]{40}$/i.test(sourceRevision)) throw new Error("Production fixture SOURCE_REVISION must be an immutable commit SHA");
  const x402Enabled = variant === "healthy" && process.env.X402_ENABLED === "true";
  if (production && variant === "healthy" && !x402Enabled) throw new Error("The production healthy fixture must enable its x402 paid resource");
  const paymentRecipient = process.env.PAYMENT_RECIPIENT as `0x${string}` | undefined;
  if (x402Enabled && (!paymentRecipient || !process.env.OKX_API_KEY || !process.env.OKX_SECRET_KEY || !process.env.OKX_PASSPHRASE)) {
    throw new Error("Paid fixture requires recipient and OKX facilitator credentials");
  }
  const paymentAmount = process.env.PAYMENT_AMOUNT_ATOMIC ?? "10000";
  if (!/^[0-9]+$/.test(paymentAmount) || BigInt(paymentAmount) < 1n || BigInt(paymentAmount) > 100_000n) {
    throw new Error("Fixture PAYMENT_AMOUNT_ATOMIC must be between 1 and 100000");
  }
  return {
    variant,
    port,
    publicBaseUrl,
    sourceRevision,
    providerKey: providerKey ?? generatePrivateKey(),
    production,
    x402Enabled,
    ...(paymentRecipient ? { paymentRecipient } : {}),
    paymentAmount,
    okxApiKey: process.env.OKX_API_KEY,
    okxSecretKey: process.env.OKX_SECRET_KEY,
    okxPassphrase: process.env.OKX_PASSPHRASE,
  };
}

export function startFixture(variant: FixtureVariant): express.Express {
  const settings = config(variant);
  const account = privateKeyToAccount(settings.providerKey);
  const app = express();
  const paidMiddleware = createPaidMiddleware(settings);
  app.disable("x-powered-by");
  app.use(express.json({ limit: "32kb" }));
  app.use((request, response, next) => {
    response.setHeader("x-content-type-options", "nosniff");
    response.setHeader("x-launchproof-fixture", variant);
    if (request.path === "/paid/mcp") return paidMiddleware(request, response, next);
    next();
  });

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok", fixture: true, variant, source_revision: settings.sourceRevision, x402: settings.x402Enabled });
  });
  app.get("/.well-known/launch-contract.json", async (_request, response, next) => {
    try {
      response.json(await signedManifest(settings, account));
    } catch (error) {
      next(error);
    }
  });
  app.post("/mcp", (request, response) => void handleMcp(request, response, settings));
  app.post("/paid/mcp", (request, response) => {
    if (!settings.x402Enabled) {
      response.status(503).json({ error: "paid_fixture_not_configured" });
      return;
    }
    const body = request.body as { run_id?: unknown };
    response.json({
      run_id: body.run_id,
      source_revision: settings.sourceRevision,
      fixture: true,
      variant,
      delivered_at: new Date().toISOString(),
    });
  });
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    response.status(500).json({ error: error instanceof Error ? error.message : "fixture_error" });
  });
  if (process.env.VERCEL !== "1") {
    app.listen(settings.port, "0.0.0.0", () => {
      process.stdout.write(JSON.stringify({ event: "fixture_started", variant, port: settings.port, provider: account.address }) + "\n");
    });
  }
  return app;
}

function createPaidMiddleware(settings: FixtureConfig): RequestHandler {
  if (!settings.x402Enabled || !settings.paymentRecipient) return (_request, _response, next) => next();
  const facilitator = new OKXFacilitatorClient({
    apiKey: settings.okxApiKey!,
    secretKey: settings.okxSecretKey!,
    passphrase: settings.okxPassphrase!,
  });
  const server = new x402ResourceServer(facilitator);
  server.register(NETWORK, new ExactEvmScheme());
  return paymentMiddleware(
    {
      "POST /paid/mcp": {
        accepts: [{ scheme: "exact", network: NETWORK, payTo: settings.paymentRecipient, price: `$${Number(settings.paymentAmount) / 1_000_000}` }],
        description: "LaunchProof controlled paid-delivery fixture",
        mimeType: "application/json",
      },
    },
    server,
  ) as RequestHandler;
}

async function signedManifest(settings: FixtureConfig, account: ReturnType<typeof privateKeyToAccount>) {
  const manifest = {
    contract_version: "1.0",
    service_name: `LaunchProof Invoice Normalizer (${settings.variant})`,
    mcp_endpoint: `${settings.publicBaseUrl}/mcp`,
    tool: "normalize_invoice",
    mode: "sample_only",
    sample_input: { invoice_text: "Invoice #101, total USD 42.00, due 2026-07-31" },
    assertions: [
      { path: "$.invoice_number", rule: "equals", value: "101" },
      { path: "$.currency", rule: "equals", value: "USD" },
      { path: "$.total", rule: "equals", value: 42 },
      { path: "$.confidence", rule: "gte", value: 0.9 },
    ],
    max_latency_ms: 8000,
    delivery_type: "synchronous_json",
    payment_mode: settings.x402Enabled ? "x402_optional" : "none",
    ...(settings.x402Enabled && settings.paymentRecipient
      ? {
          payment: {
            network: NETWORK,
            asset: USDT0,
            amount: settings.paymentAmount,
            recipient: settings.paymentRecipient,
            resource_url: `${settings.publicBaseUrl}/paid/mcp`,
          },
        }
      : {}),
    safe_use: ["read-only sample data", "no account", "no external side effect"],
    source_revision: settings.sourceRevision,
    challenge_profile: {
      name: "structured-extraction-v1",
      tool: "normalize_invoice",
      input_field: "document_text",
      output_fields: ["document_id", "currency", "total", "due_date"],
      challenge_runs: 3,
      max_latency_ms_per_run: 8000,
      safe_mode: "synthetic_read_only",
    },
    provider_address: account.address,
    fixture: true,
  } as const;
  const hash = `0x${createHash("sha256").update(canonicalize(manifest)).digest("hex")}` as `0x${string}`;
  const declaration_signature = await account.signMessage({ message: { raw: hash } });
  return { ...manifest, declaration_signature };
}

async function handleMcp(request: Request, response: Response, settings: FixtureConfig) {
  const message = request.body as { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: Record<string, unknown> };
  if (message.method === "notifications/initialized") {
    response.status(202).end();
    return;
  }
  if (message.method === "initialize") {
    rpc(response, message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: `launchproof-${settings.variant}`, version: "1.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    rpc(response, message.id, {
      tools: [
        {
          name: "normalize_invoice",
          description: "Extract bounded fields from a synthetic invoice.",
          inputSchema: {
            type: "object",
            properties: { invoice_text: { type: "string", maxLength: 1000 }, document_text: { type: "string", maxLength: 1000 } },
            anyOf: [{ required: ["invoice_text"] }, { required: ["document_text"] }],
            additionalProperties: false,
          },
        },
      ],
    });
    return;
  }
  if (message.method === "tools/call") {
    const params = message.params as { name?: unknown; arguments?: unknown } | undefined;
    if (params?.name !== "normalize_invoice") {
      rpcError(response, message.id, -32602, "Unknown tool");
      return;
    }
    const args = params.arguments;
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      toolError(response, message.id, "INVALID_INPUT", "Provide exactly one bounded invoice text field");
      return;
    }
    const input = args as Record<string, unknown>;
    const text = typeof input.invoice_text === "string" ? input.invoice_text : typeof input.document_text === "string" ? input.document_text : null;
    if (!text || text.length > 1000) {
      toolError(response, message.id, "INVALID_INPUT", "invoice_text or document_text is required and must be at most 1000 characters");
      return;
    }
    if (settings.variant === "timeout" && input.document_text) await new Promise((resolve) => setTimeout(resolve, 9_000));
    const output = normalize(text);
    if (!output) {
      toolError(response, message.id, "INVALID_INPUT", "Input does not match the synthetic invoice format");
      return;
    }
    if (settings.variant === "invalid-output" && input.document_text) output.total = `${Number(output.total) + 1}.00`;
    if (settings.variant === "schema-drift" && input.document_text) {
      const id = output.document_id;
      delete output.document_id;
      output.invoice_id = id;
    }
    rpc(response, message.id, { content: [{ type: "text", text: JSON.stringify(output) }], structuredContent: output });
    return;
  }
  rpcError(response, message.id, -32601, "Method not found");
}

function normalize(text: string): Record<string, unknown> | null {
  const fixed = text.match(/Invoice #(\d+), total ([A-Z]{3}) (\d+\.\d{2}), due (\d{4}-\d{2}-\d{2})/);
  if (fixed) return { invoice_number: fixed[1], currency: fixed[2], total: Number(fixed[3]), due_date: fixed[4], confidence: 0.99 };
  const challenge = text.match(/Synthetic invoice (LP-[A-F0-9]+); currency ([A-Z]{3}); total (\d+\.\d{2}); due (\d{4}-\d{2}-\d{2})\./);
  if (challenge) return { document_id: challenge[1], currency: challenge[2], total: challenge[3], due_date: challenge[4] };
  return null;
}

function rpc(response: Response, id: unknown, result: unknown) {
  response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(response: Response, id: unknown, code: number, message: string) {
  response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function toolError(response: Response, id: unknown, code: string, message: string) {
  rpc(response, id, { isError: true, content: [{ type: "text", text: JSON.stringify({ code, message }) }] });
}
