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
  REGISTRY_WRITER_PRIVATE_KEY: `0x${"22".repeat(32)}`,
  TARGET_PAYER_PRIVATE_KEY: `0x${"33".repeat(32)}`,
  PAYOUT_ADDRESS: `0x${"44".repeat(20)}`,
  DATABASE_URL: "postgresql://launchproof:secret@db.example/launchproof",
  OKX_API_KEY: "key",
  OKX_SECRET_KEY: "secret",
  OKX_PASSPHRASE: "passphrase",
  FIXTURE_BASE_DOMAIN: "fixtures.launchproof.example",
  FIXTURE_HEALTHY_PROVIDER_ADDRESS: `0x${"51".repeat(20)}`,
  FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS: `0x${"52".repeat(20)}`,
  FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS: `0x${"53".repeat(20)}`,
  FIXTURE_TIMEOUT_PROVIDER_ADDRESS: `0x${"54".repeat(20)}`,
} satisfies NodeJS.ProcessEnv;

describe("production configuration", () => {
  it("fails closed when a required production dependency is missing", () => {
    const { FIXTURE_BASE_DOMAIN: _missing, ...incomplete } = production;
    expect(() => loadConfig(incomplete)).toThrow(/Production startup refused/);
  });

  it("marks a complete, immutable HTTPS configuration ready", () => {
    expect(loadConfig(production).productionReady).toBe(true);
  });
});
