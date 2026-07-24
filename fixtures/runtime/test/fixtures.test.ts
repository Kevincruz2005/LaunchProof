import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureApp, fixtureChallengeDelayMs, type FixtureVariant } from "../src/index.js";

const variants: FixtureVariant[] = ["healthy", "invalid-output", "schema-drift", "timeout"];
const sourceRevision = "a".repeat(40);

function configure(variant: FixtureVariant): void {
  process.env.NODE_ENV = "test";
  process.env.FIXTURE_PROVIDER_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  process.env.PUBLIC_BASE_URL = `https://${variant}.fixtures.example`;
  process.env.SOURCE_REVISION = sourceRevision;
  process.env.XLAYER_TESTNET = "true";
  process.env.ALLOW_XLAYER_MAINNET = "false";
  process.env.XLAYER_CHAIN_ID = "1952";
  process.env.XLAYER_NETWORK = "eip155:1952";
  process.env.XLAYER_USDT0_ADDRESS = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c";
  process.env.X402_ENABLED = "false";
  process.env.PAYMENT_AMOUNT_ATOMIC = "10000";
  process.env.OKX_BASE_URL = "https://web3.okx.com";
}

function configureProduction(variant: FixtureVariant): void {
  configure(variant);
  process.env.NODE_ENV = "production";
  process.env.FIXTURE_PROVIDER_PRIVATE_KEY = `0x${"0123456789abcdef".repeat(4)}`;
  process.env.FIXTURE_PROVIDER_KEY_SOURCE = "external-secret";
  process.env.PUBLIC_BASE_URL = `https://${variant}.fixtures.launchproof.dev`;
  process.env.RELEASE_IMAGE_TAG = sourceRevision;
  process.env.RELEASE_IMAGE_DIGEST = `sha256:${"b".repeat(64)}`;
}

describe("controlled fixture runtime", () => {
  beforeEach(() => configure("healthy"));
  afterEach(() => {
    for (const name of [
      "NODE_ENV", "FIXTURE_PROVIDER_PRIVATE_KEY", "PUBLIC_BASE_URL", "SOURCE_REVISION",
      "XLAYER_TESTNET", "ALLOW_XLAYER_MAINNET", "XLAYER_CHAIN_ID", "XLAYER_NETWORK",
      "XLAYER_USDT0_ADDRESS", "X402_ENABLED", "PAYMENT_AMOUNT_ATOMIC", "OKX_BASE_URL",
      "PAYMENT_RECIPIENT", "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE",
      "FIXTURE_PROVIDER_KEY_SOURCE", "RELEASE_IMAGE_TAG", "RELEASE_IMAGE_DIGEST",
    ]) delete process.env[name];
  });

  it.each(variants)("serves immutable identity and health for %s", async (variant) => {
    configure(variant);
    const app = createFixtureApp(variant);
    const health = await request(app).get("/healthz").expect(200);
    expect(health.body).toMatchObject({
      status: "ok",
      fixture: true,
      variant,
      source_revision: sourceRevision,
      network: "eip155:1952",
    });
    const manifest = await request(app).get("/.well-known/launch-contract.json").expect(200);
    expect(manifest.body.source_revision).toBe(sourceRevision);
    expect(manifest.body.mcp_endpoint).toBe(`https://${variant}.fixtures.example/mcp`);
    expect(manifest.body.declaration_signature).toMatch(/^0x[0-9a-f]{130}$/i);
  });

  it("produces the intended invalid-output and schema-drift behaviors", async () => {
    const call = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "normalize_invoice",
        arguments: { document_text: "Synthetic invoice LP-ABC123; currency USD; total 42.00; due 2026-08-15." },
      },
    };
    configure("invalid-output");
    const invalid = await request(createFixtureApp("invalid-output")).post("/mcp").send(call).expect(200);
    expect(invalid.body.result.structuredContent.total).toBe("43.00");

    configure("schema-drift");
    const drift = await request(createFixtureApp("schema-drift")).post("/mcp").send(call).expect(200);
    expect(drift.body.result.structuredContent).not.toHaveProperty("document_id");
    expect(drift.body.result.structuredContent.invoice_id).toBe("LP-ABC123");
  });

  it("uses a deliberate challenge-only timeout", () => {
    expect(fixtureChallengeDelayMs("timeout", { document_text: "synthetic" })).toBe(9_000);
    expect(fixtureChallengeDelayMs("timeout", { invoice_text: "fixed" })).toBe(0);
    expect(fixtureChallengeDelayMs("healthy", { document_text: "synthetic" })).toBe(0);
  });

  it("refuses a production healthy fixture without x402", () => {
    configureProduction("healthy");
    expect(() => createFixtureApp("healthy")).toThrow(/requires.*x402/i);
  });

  it("refuses generated/default fixture identities in production", () => {
    configure("invalid-output");
    process.env.NODE_ENV = "production";
    process.env.FIXTURE_PROVIDER_KEY_SOURCE = "external-secret";
    expect(() => createFixtureApp("invalid-output")).toThrow(/default\/generated development keys/i);
  });

  it("refuses placeholder/local origins and missing immutable image identity in production", () => {
    configureProduction("invalid-output");
    process.env.PUBLIC_BASE_URL = "https://fixture.example";
    expect(() => createFixtureApp("invalid-output")).toThrow(/production fixtures require HTTPS/i);

    configureProduction("invalid-output");
    delete process.env.RELEASE_IMAGE_DIGEST;
    expect(() => createFixtureApp("invalid-output")).toThrow(/RELEASE_IMAGE_DIGEST/i);
  });

  it("refuses placeholder facilitator credentials in a paid production fixture", () => {
    configureProduction("healthy");
    process.env.X402_ENABLED = "true";
    process.env.PAYMENT_RECIPIENT = `0x${"2".repeat(40)}`;
    process.env.OKX_API_KEY = "synthetic-api-credential";
    process.env.OKX_SECRET_KEY = "secret";
    process.env.OKX_PASSPHRASE = "synthetic-passphrase";
    expect(() => createFixtureApp("healthy")).toThrow(/placeholder credential/i);
  });
});
