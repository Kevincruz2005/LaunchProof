import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const production = {
  NODE_ENV: "production",
  PUBLIC_API_BASE_URL: "https://api.launchproof.example",
  PUBLIC_WEB_BASE_URL: "https://launchproof.example",
  BUILD_COMMIT_SHA: "a".repeat(40),
  SOURCE_REPOSITORY: "https://github.com/example/launchproof",
  X402_ENABLED: "true",
  XLAYER_RPC_URL: "https://rpc.example/primary",
  XLAYER_FALLBACK_RPC_URL: "https://rpc.example/fallback",
  REGISTRY_ADDRESS: `0x${"11".repeat(20)}`,
  REGISTRY_DEPLOYMENT_BLOCK: "1",
  REGISTRY_RUNTIME_CODE_HASH: `0x${"ab".repeat(32)}`,
  REGISTRY_WRITER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
  TARGET_PAYER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
  PAYOUT_ADDRESS: `0x${"44".repeat(20)}`,
  DATABASE_URL: "postgresql://launchproof:secret@db.example/launchproof",
  OKX_API_KEY: "key",
  OKX_SECRET_KEY: "secret",
  OKX_PASSPHRASE: "passphrase",
  FIXTURE_HEALTHY_URL: "https://healthy.fixtures.launchproof.example",
  FIXTURE_INVALID_OUTPUT_URL: "https://invalid-output.fixtures.launchproof.example",
  FIXTURE_SCHEMA_DRIFT_URL: "https://schema-drift.fixtures.launchproof.example",
  FIXTURE_TIMEOUT_URL: "https://timeout.fixtures.launchproof.example",
  FIXTURE_HEALTHY_PROVIDER_ADDRESS: `0x${"51".repeat(20)}`,
  FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS: `0x${"52".repeat(20)}`,
  FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS: `0x${"53".repeat(20)}`,
  FIXTURE_TIMEOUT_PROVIDER_ADDRESS: `0x${"54".repeat(20)}`,
  TARGET_ALLOWLIST: "healthy.fixtures.launchproof.example,invalid-output.fixtures.launchproof.example,schema-drift.fixtures.launchproof.example,timeout.fixtures.launchproof.example",
} satisfies NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("fails closed when a required production dependency is missing", () => {
    const { FIXTURE_HEALTHY_URL: _missing, ...incomplete } = production;
    expect(() => loadConfig(incomplete)).toThrow(/Production startup refused/);
  });

  it("marks a complete, immutable HTTPS configuration ready", () => {
    expect(loadConfig(production).productionReady).toBe(true);
  });

  it("defaults to X Layer testnet and rejects accidental mainnet", () => {
    expect(loadConfig({ NODE_ENV: "test" }).chain.network).toBe("eip155:1952");
    expect(() => loadConfig({ NODE_ENV: "test", XLAYER_TESTNET: "false", ALLOW_XLAYER_MAINNET: "true" })).toThrow(/mainnet is unsupported/i);
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
});
