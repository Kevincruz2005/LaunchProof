import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const production = {
  NODE_ENV: "production",
  BACKEND_MODE: "writer",
  PUBLIC_API_BASE_URL: "https://api.launchproof.dev",
  PUBLIC_WEB_BASE_URL: "https://launchproof.dev",
  PUBLIC_ALLOWED_ORIGINS: "https://launchproof.dev",
  BUILD_COMMIT_SHA: "a".repeat(40),
  RELEASE_IMAGE_TAG: "a".repeat(40),
  RELEASE_IMAGE_DIGEST: `sha256:${"b".repeat(64)}`,
  SOURCE_REPOSITORY: "https://github.com/example/launchproof",
  XLAYER_TESTNET: "true",
  XLAYER_CHAIN_ID: "1952",
  XLAYER_NETWORK: "eip155:1952",
  XLAYER_USDT0_ADDRESS: "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c",
  XLAYER_EXPLORER_URL: "https://www.okx.com/web3/explorer/xlayer-test",
  X402_ENABLED: "true",
  XLAYER_RPC_URL: "https://testrpc.xlayer.tech/terigon",
  XLAYER_FALLBACK_RPC_URL: "https://xlayertestrpc.okx.com/terigon",
  REGISTRY_ADDRESS: `0x${"11".repeat(20)}`,
  REGISTRY_DEPLOYMENT_BLOCK: "1",
  REGISTRY_RUNTIME_CODE_HASH: `0x${"ab".repeat(32)}`,
  REGISTRY_WRITER_PRIVATE_KEY: `0x${"0123456789abcdef".repeat(4)}`,
  TARGET_PAYER_PRIVATE_KEY: `0x${"fedcba9876543210".repeat(4)}`,
  PAYOUT_ADDRESS: `0x${"44".repeat(20)}`,
  DATABASE_URL: "postgresql://launchproof:synthetic-long-password@database.launchproof.dev/launchproof",
  LEADERSHIP_DATABASE_URL: "postgresql://launchproof:synthetic-long-password@session-database.launchproof.dev/launchproof",
  LEADERSHIP_DATABASE_MODE: "session",
  OKX_API_KEY: "synthetic-api-credential",
  OKX_SECRET_KEY: "synthetic-secret-credential-value",
  OKX_PASSPHRASE: "synthetic-passphrase",
  OKX_BASE_URL: "https://web3.okx.com",
  FIXTURE_HEALTHY_URL: "https://healthy.fixtures.launchproof.dev",
  FIXTURE_INVALID_OUTPUT_URL: "https://invalid-output.fixtures.launchproof.dev",
  FIXTURE_SCHEMA_DRIFT_URL: "https://schema-drift.fixtures.launchproof.dev",
  FIXTURE_TIMEOUT_URL: "https://timeout.fixtures.launchproof.dev",
  FIXTURE_HEALTHY_PROVIDER_ADDRESS: `0x${"51".repeat(20)}`,
  FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS: `0x${"52".repeat(20)}`,
  FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS: `0x${"53".repeat(20)}`,
  FIXTURE_TIMEOUT_PROVIDER_ADDRESS: `0x${"54".repeat(20)}`,
  TARGET_ALLOWLIST: "healthy.fixtures.launchproof.dev,invalid-output.fixtures.launchproof.dev,schema-drift.fixtures.launchproof.dev,timeout.fixtures.launchproof.dev",
} satisfies NodeJS.ProcessEnv;

const readOnlyProduction = {
  ...production,
  BACKEND_MODE: "read-only",
  X402_ENABLED: "false",
  REGISTRY_WRITER_PRIVATE_KEY: undefined,
  TARGET_PAYER_PRIVATE_KEY: undefined,
  LEADERSHIP_DATABASE_URL: undefined,
  LEADERSHIP_DATABASE_MODE: undefined,
  OKX_API_KEY: undefined,
  OKX_SECRET_KEY: undefined,
  OKX_PASSPHRASE: undefined,
} satisfies NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("fails closed when a required production dependency is missing", () => {
    const { FIXTURE_HEALTHY_URL: _missing, ...incomplete } = production;
    expect(() => loadConfig(incomplete)).toThrow(/Production startup refused/);
  });

  it("marks a complete, immutable HTTPS configuration ready", () => {
    expect(loadConfig(production).productionReady).toBe(true);
  });

  it("starts a complete read-only production configuration without any writer capability", () => {
    const configured = loadConfig(readOnlyProduction);
    expect(configured.readOnly).toBe(true);
    expect(configured.productionReady).toBe(true);
    expect(configured.chainReady).toBe(true);
    expect(configured.publicationReady).toBe(false);
    expect(configured.paymentReady).toBe(false);
    expect(configured.X402_ENABLED).toBe(false);
    expect(configured.REGISTRY_WRITER_PRIVATE_KEY).toBeUndefined();
    expect(configured.TARGET_PAYER_PRIVATE_KEY).toBeUndefined();
    expect(configured.LEADERSHIP_DATABASE_URL).toBeUndefined();
  });

  it("rejects every writer, payment, recovery, and bypass capability in read-only mode", () => {
    for (const [name, value] of [
      ["X402_ENABLED", "true"],
      ["REGISTRY_WRITER_PRIVATE_KEY", production.REGISTRY_WRITER_PRIVATE_KEY],
      ["TARGET_PAYER_PRIVATE_KEY", production.TARGET_PAYER_PRIVATE_KEY],
      ["LEADERSHIP_DATABASE_URL", production.LEADERSHIP_DATABASE_URL],
      ["LEADERSHIP_DATABASE_MODE", "session"],
      ["OKX_API_KEY", production.OKX_API_KEY],
      ["OKX_SECRET_KEY", production.OKX_SECRET_KEY],
      ["OKX_PASSPHRASE", production.OKX_PASSPHRASE],
      ["ALLOW_LOCAL_UNPAID_RUNS", "true"],
      ["ALLOW_PRIVATE_TARGETS", "true"],
    ] as const) {
      expect(() => loadConfig({ ...readOnlyProduction, [name]: value })).toThrow(/Read-only backend forbids/);
    }
  });

  it("requires a dedicated session-mode PostgreSQL leadership connection", () => {
    const { LEADERSHIP_DATABASE_URL: _url, ...missingUrl } = production;
    expect(() => loadConfig(missingUrl)).toThrow(/Production startup refused|leadership/i);
    const { LEADERSHIP_DATABASE_MODE: _mode, ...missingMode } = production;
    expect(() => loadConfig(missingMode)).toThrow(/Production startup refused|leadership/i);
    expect(() => loadConfig({
      ...production,
      LEADERSHIP_DATABASE_URL: "postgresql://launchproof:synthetic-long-password@localhost/launchproof",
    })).toThrow(/public|placeholder/i);
  });

  it("requires explicit testnet identity and immutable image provenance in production", () => {
    const { XLAYER_NETWORK: _network, ...missingNetwork } = production;
    expect(() => loadConfig(missingNetwork)).toThrow(/explicit configuration.*XLAYER_NETWORK/i);
    expect(() => loadConfig({ ...production, RELEASE_IMAGE_TAG: "c".repeat(40) })).toThrow(/must equal.*BUILD_COMMIT_SHA/i);
    expect(() => loadConfig({ ...production, RELEASE_IMAGE_DIGEST: "sha256:not-a-digest" })).toThrow();
  });

  it("refuses placeholder, local, credential-bearing, and weak production configuration", () => {
    expect(() => loadConfig({ ...production, PUBLIC_API_BASE_URL: "https://api.example" })).toThrow(/non-placeholder/i);
    expect(() => loadConfig({ ...production, PUBLIC_WEB_BASE_URL: "https://localhost" })).toThrow(/non-placeholder/i);
    expect(() => loadConfig({ ...production, FIXTURE_HEALTHY_URL: "https://user:pass@healthy.fixtures.launchproof.dev" })).toThrow(/public.*HTTPS origin/i);
    expect(() => loadConfig({ ...production, OKX_SECRET_KEY: "secret" })).toThrow(/placeholder credential/i);
    expect(() => loadConfig({ ...production, REGISTRY_WRITER_PRIVATE_KEY: `0x${"22".repeat(32)}` })).toThrow(/development identities/i);
  });

  it("defaults to X Layer testnet and rejects accidental mainnet", () => {
    expect(loadConfig({ NODE_ENV: "test" }).chain.network).toBe("eip155:1952");
    expect(() => loadConfig({ NODE_ENV: "test", XLAYER_TESTNET: "false", ALLOW_XLAYER_MAINNET: "true" })).toThrow(/mainnet is unsupported/i);
    expect(() => loadConfig({ NODE_ENV: "test", XLAYER_CHAIN_ID: "1", XLAYER_NETWORK: "eip155:1" })).toThrow(/must be 1952/i);
    expect(() => loadConfig({ NODE_ENV: "test", XLAYER_CHAIN_ID: "999999", XLAYER_NETWORK: "eip155:999999" })).toThrow(/must be 1952/i);
  });

  it("uses the real public repository as the source default", () => {
    expect(loadConfig({ NODE_ENV: "test" }).SOURCE_REPOSITORY).toBe("https://github.com/Kevincruz2005/LaunchProof");
  });

  it("rejects arbitrary token overrides and zero operational roles", () => {
    expect(() => loadConfig({ NODE_ENV: "test", XLAYER_USDT0_ADDRESS: `0x${"99".repeat(20)}` })).toThrow(/official X Layer Testnet/);
    expect(() => loadConfig({ NODE_ENV: "test", REGISTRY_ADDRESS: `0x${"00".repeat(20)}` })).toThrow(/nonzero/);
  });

  it("locks the facilitator to the official OKX Web3 origin", () => {
    expect(loadConfig({ NODE_ENV: "test" }).OKX_BASE_URL).toBe("https://web3.okx.com");
    expect(() => loadConfig({ NODE_ENV: "test", OKX_BASE_URL: "https://www.okx.com" })).toThrow(/official/);
    expect(() => loadConfig({ NODE_ENV: "test", OKX_BASE_URL: "https://web3.okx.com/facilitator" })).toThrow(/exactly/);
  });

  it("rejects private-target and unpaid bypasses on a public origin", () => {
    expect(() => loadConfig({
      NODE_ENV: "test",
      PUBLIC_API_BASE_URL: "https://api.example",
      ALLOW_LOCAL_UNPAID_RUNS: "true",
    })).toThrow(/loopback/);
  });

  it("refuses public and chain-ready services in development mode", () => {
    expect(() => loadConfig({
      NODE_ENV: "development",
      PUBLIC_API_BASE_URL: "https://api.example",
    })).toThrow(/NODE_ENV=production/);
    expect(() => loadConfig({
      NODE_ENV: "development",
      BUILD_COMMIT_SHA: "a".repeat(40),
      XLAYER_RPC_URL: production.XLAYER_RPC_URL,
      REGISTRY_ADDRESS: production.REGISTRY_ADDRESS,
      REGISTRY_DEPLOYMENT_BLOCK: production.REGISTRY_DEPLOYMENT_BLOCK,
      REGISTRY_RUNTIME_CODE_HASH: production.REGISTRY_RUNTIME_CODE_HASH,
      REGISTRY_WRITER_PRIVATE_KEY: production.REGISTRY_WRITER_PRIVATE_KEY,
    })).toThrow(/NODE_ENV=production/);
  });

  it("validates PassportGate deployment freshness defaults", () => {
    const configured = loadConfig({
      NODE_ENV: "test",
      PASSPORT_GATE_WARN_AGE_HOURS: "12",
      PASSPORT_GATE_MAX_AGE_HOURS: "48",
    });
    expect(configured.PASSPORT_GATE_WARN_AGE_HOURS).toBe(12);
    expect(configured.PASSPORT_GATE_MAX_AGE_HOURS).toBe(48);
    expect(() => loadConfig({
      NODE_ENV: "test",
      PASSPORT_GATE_WARN_AGE_HOURS: "48",
      PASSPORT_GATE_MAX_AGE_HOURS: "48",
    })).toThrow(/must be greater/);
  });
});
