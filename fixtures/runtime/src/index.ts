import { createHash } from "node:crypto";
import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import { canonicalize } from "json-canonicalize";
import { privateKeyToAccount } from "viem/accounts";
import { OKXFacilitatorClient } from "@okxweb3/x402-core";
import type { Network } from "@okxweb3/x402-core/types";
import { ExactEvmScheme } from "@okxweb3/x402-evm/exact/server";
import { paymentMiddleware, x402ResourceServer } from "@okxweb3/x402-express";

export type FixtureVariant = "healthy" | "invalid-output" | "schema-drift" | "timeout";

const XLAYER_TESTNET_USDT0_ADDRESS = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";

interface FixtureConfig {
  variant: FixtureVariant;
  port: number;
  bindHost: "127.0.0.1" | "0.0.0.0" | "::1";
  publicBaseUrl: string;
  sourceRevision: string;
  providerKey: `0x${string}`;
  x402Enabled: boolean;
  network: Network;
  assetAddress: `0x${string}`;
  paymentRecipient?: `0x${string}`;
  paymentAmount: string;
  okxApiKey: string | undefined;
  okxSecretKey: string | undefined;
  okxPassphrase: string | undefined;
  okxBaseUrl: string;
}

function config(variant: FixtureVariant): FixtureConfig {
  const production = process.env.NODE_ENV === "production";
  const providerKey = process.env.FIXTURE_PROVIDER_PRIVATE_KEY as `0x${string}` | undefined;
  if (!providerKey || !/^0x[0-9a-fA-F]{64}$/.test(providerKey)) {
    throw new Error("Fixture requires a unique FIXTURE_PROVIDER_PRIVATE_KEY; generate it outside the process and never commit it");
  }
  const port = Number(process.env.PORT ?? 4100);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("Fixture PORT must be an integer between 1 and 65535");
  const bindHost = process.env.FIXTURE_BIND_HOST ?? "127.0.0.1";
  if (bindHost !== "127.0.0.1" && bindHost !== "0.0.0.0" && bindHost !== "::1") {
    throw new Error("FIXTURE_BIND_HOST must be 127.0.0.1, ::1, or 0.0.0.0");
  }
  const publicBaseUrl = required("PUBLIC_BASE_URL").replace(/\/$/, "");
  const parsedPublicUrl = new URL(publicBaseUrl);
  if (parsedPublicUrl.origin !== publicBaseUrl || (production && parsedPublicUrl.protocol !== "https:")) {
    throw new Error("PUBLIC_BASE_URL must be a URL origin; production fixtures require HTTPS");
  }
  const sourceRevision = required("SOURCE_REVISION");
  if (!/^[0-9a-f]{40}$/i.test(sourceRevision)) throw new Error("Fixture SOURCE_REVISION must be the exact immutable 40-character Git commit SHA");
  if (required("XLAYER_TESTNET") !== "true" || process.env.ALLOW_XLAYER_MAINNET === "true") {
    throw new Error("Controlled public fixtures are restricted to X Layer testnet");
  }
  const chainId = required("XLAYER_CHAIN_ID");
  if (!/^[1-9][0-9]*$/.test(chainId)) throw new Error("XLAYER_CHAIN_ID must be a positive decimal chain ID");
  if (chainId !== "1952") throw new Error("X Layer testnet chain ID must be 1952");
  const network = required("XLAYER_NETWORK") as Network;
  if (network !== `eip155:${chainId}`) throw new Error("XLAYER_NETWORK must match XLAYER_CHAIN_ID in CAIP-2 form");
  const assetAddress = required("XLAYER_USDT0_ADDRESS") as `0x${string}`;
  if (!/^0x[0-9a-fA-F]{40}$/.test(assetAddress) || /^0x0{40}$/i.test(assetAddress)) throw new Error("XLAYER_USDT0_ADDRESS must be a nonzero EVM address");
  if (assetAddress.toLowerCase() !== XLAYER_TESTNET_USDT0_ADDRESS) {
    throw new Error(`Controlled fixtures require the official X Layer testnet USD₮0 contract ${XLAYER_TESTNET_USDT0_ADDRESS}`);
  }
  const x402Enabled = variant === "healthy" && process.env.X402_ENABLED === "true";
  if (production && variant === "healthy" && !x402Enabled) {
    throw new Error("The production healthy fixture requires its exact x402 paid resource");
  }
  const paymentRecipient = process.env.PAYMENT_RECIPIENT as `0x${string}` | undefined;
  if (x402Enabled && (!paymentRecipient || !/^0x[0-9a-fA-F]{40}$/.test(paymentRecipient) || /^0x0{40}$/i.test(paymentRecipient) || !process.env.OKX_API_KEY || !process.env.OKX_SECRET_KEY || !process.env.OKX_PASSPHRASE)) {
    throw new Error("Paid fixture requires recipient and OKX facilitator credentials");
  }
  const paymentAmount = required("PAYMENT_AMOUNT_ATOMIC");
  if (!/^[0-9]+$/.test(paymentAmount) || BigInt(paymentAmount) < 1n || BigInt(paymentAmount) > 100_000n) {
    throw new Error("Fixture PAYMENT_AMOUNT_ATOMIC must be between 1 and 100000");
  }
  const okxBaseUrl = required("OKX_BASE_URL");
  const parsedOkxUrl = new URL(okxBaseUrl);
  if (
    parsedOkxUrl.origin !== "https://web3.okx.com" ||
    parsedOkxUrl.pathname !== "/" ||
    parsedOkxUrl.search ||
    parsedOkxUrl.hash ||
    parsedOkxUrl.username ||
    parsedOkxUrl.password
  ) {
    throw new Error("OKX_BASE_URL must be the exact official origin https://web3.okx.com");
  }
  return {
    variant,
    port,
    bindHost,
    publicBaseUrl,
    sourceRevision,
    providerKey,
    x402Enabled,
    network,
    assetAddress,
    ...(paymentRecipient ? { paymentRecipient } : {}),
    paymentAmount,
    okxApiKey: process.env.OKX_API_KEY,
    okxSecretKey: process.env.OKX_SECRET_KEY,
    okxPassphrase: process.env.OKX_PASSPHRASE,
    okxBaseUrl: parsedOkxUrl.origin,
  };
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Fixture requires ${name}`);
  return value;
}

export function createFixtureApp(variant: FixtureVariant): express.Express {
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
    response.json({
      status: "ok",
      fixture: true,
      variant,
      source_revision: settings.sourceRevision,
      x402: settings.x402Enabled,
      network: settings.network,
      asset: settings.assetAddress,
    });
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
  return app;
}

export function startFixture(variant: FixtureVariant): void {
  const settings = config(variant);
  const account = privateKeyToAccount(settings.providerKey);
  const app = createFixtureApp(variant);
  app.listen(settings.port, settings.bindHost, () => {
    process.stdout.write(JSON.stringify({ event: "fixture_started", variant, host: settings.bindHost, port: settings.port, provider: account.address }) + "\n");
  });
}

function createPaidMiddleware(settings: FixtureConfig): RequestHandler {
  if (!settings.x402Enabled || !settings.paymentRecipient) return (_request, _response, next) => next();
  const facilitator = new OKXFacilitatorClient({
    apiKey: settings.okxApiKey!,
    secretKey: settings.okxSecretKey!,
    passphrase: settings.okxPassphrase!,
    baseUrl: settings.okxBaseUrl,
    syncSettle: true,
  });
  const server = new x402ResourceServer(facilitator);
  server.register(settings.network, new ExactEvmScheme());
  return paymentMiddleware(
    {
      "POST /paid/mcp": {
        accepts: [
          {
            scheme: "exact",
            network: settings.network,
            payTo: settings.paymentRecipient,
            price: { amount: settings.paymentAmount, asset: settings.assetAddress },
          },
        ],
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
            network: settings.network,
            asset: settings.assetAddress,
            amount: settings.paymentAmount,
            recipient: settings.paymentRecipient,
            resource_url: `${settings.publicBaseUrl}/paid/mcp`,
          },
        }
      : {}),
    safe_use: [
      "tool is read-only for synthetic sample data",
      "no credentials or account",
      "no tool side effect beyond the declared x402 payment",
    ],
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
    const delayMs = fixtureChallengeDelayMs(settings.variant, input);
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
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

export function fixtureChallengeDelayMs(variant: FixtureVariant, input: Record<string, unknown>): number {
  return variant === "timeout" && typeof input.document_text === "string" ? 9_000 : 0;
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
