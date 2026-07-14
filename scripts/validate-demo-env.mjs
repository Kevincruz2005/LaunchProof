import { existsSync, readFileSync } from "node:fs";

const fileValues = {};
if (existsSync(".env")) {
  for (const rawLine of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const name = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    fileValues[name] = value;
  }
}

const values = { ...fileValues, ...process.env };
const required = [
  "XLAYER_RPC_URL", "XLAYER_FALLBACK_RPC_URL", "REGISTRY_ADDRESS", "REGISTRY_DEPLOYMENT_BLOCK",
  "REGISTRY_WRITER_PRIVATE_KEY", "TARGET_PAYER_PRIVATE_KEY", "PAYOUT_ADDRESS",
  "PUBLIC_API_BASE_URL", "PUBLIC_WEB_BASE_URL", "BUILD_COMMIT_SHA", "SOURCE_REPOSITORY",
  "OKX_API_KEY", "OKX_SECRET_KEY", "OKX_PASSPHRASE", "FIXTURE_BASE_DOMAIN",
  "FIXTURE_HEALTHY_PROVIDER_ADDRESS", "FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS",
  "FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS", "FIXTURE_TIMEOUT_PROVIDER_ADDRESS", "TARGET_ALLOWLIST",
];
const missing = required.filter((name) => !values[name]);
if (missing.length) throw new Error(`Missing required production demo values: ${missing.join(", ")}`);
if (values.NODE_ENV !== "production") throw new Error("NODE_ENV must be production for a mainnet evidence demo");
if (values.X402_ENABLED !== "true") throw new Error("X402_ENABLED must be true for a mainnet evidence demo");
if (!/^https:\/\//.test(values.PUBLIC_API_BASE_URL) || !/^https:\/\//.test(values.PUBLIC_WEB_BASE_URL)) throw new Error("Public demo URLs must use HTTPS");
if (!/^[0-9a-f]{40}$/i.test(values.BUILD_COMMIT_SHA)) throw new Error("BUILD_COMMIT_SHA must be an immutable 40-character commit");
process.stdout.write("Production demo configuration names and public invariants validated.\n");
