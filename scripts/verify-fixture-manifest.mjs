import { deepStrictEqual } from "node:assert";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const [
  target,
  expectedRevision,
  expectedBaseUrl,
  expectedVariant,
  expectedNetwork,
  expectedAsset,
  expectedPaymentMode,
  expectedRecipient,
  expectedAmount,
] = process.argv.slice(2);

if (
  !target ||
  !expectedRevision ||
  !expectedBaseUrl ||
  !expectedVariant ||
  !expectedNetwork ||
  !expectedAsset ||
  !expectedPaymentMode
) {
  throw new Error(
    "usage: node scripts/verify-fixture-manifest.mjs URL SOURCE_SHA PUBLIC_BASE_URL VARIANT NETWORK ASSET PAYMENT_MODE [RECIPIENT] [ATOMIC_AMOUNT]",
  );
}

const variants = new Set(["healthy", "invalid-output", "schema-drift", "timeout"]);
if (!variants.has(expectedVariant)) throw new Error(`Unknown fixture variant: ${expectedVariant}`);
if (!/^[0-9a-fA-F]{40}$/.test(expectedRevision)) throw new Error("Expected source revision must be a 40-character commit SHA");
if (!/^eip155:[1-9][0-9]*$/.test(expectedNetwork)) throw new Error("Expected network must be a CAIP-2 EVM network");
if (!isAddress(expectedAsset)) throw new Error("Expected asset must be a nonzero EVM address");
if (expectedPaymentMode !== "none" && expectedPaymentMode !== "x402_optional") {
  throw new Error("Expected payment mode must be none or x402_optional");
}
if (expectedPaymentMode === "x402_optional") {
  if (!isAddress(expectedRecipient)) throw new Error("Paid fixture verification requires a nonzero expected recipient");
  if (!expectedAmount || !/^[0-9]+$/.test(expectedAmount) || BigInt(expectedAmount) < 1n || BigInt(expectedAmount) > 100_000n) {
    throw new Error("Paid fixture verification requires an atomic amount between 1 and 100000");
  }
}

const baseUrl = new URL(expectedBaseUrl);
if (baseUrl.origin !== expectedBaseUrl.replace(/\/$/, "")) throw new Error("Expected public base URL must be an origin");
const manifestUrl = target.endsWith("/.well-known/launch-contract.json")
  ? target
  : `${target.replace(/\/$/, "")}/.well-known/launch-contract.json`;
if (new URL(manifestUrl).origin !== baseUrl.origin) throw new Error("Manifest URL and expected public base URL use different origins");

const requireFromRuntime = createRequire(new URL("../fixtures/runtime/package.json", import.meta.url));
const { canonicalize } = requireFromRuntime("json-canonicalize");
const { verifyMessage } = requireFromRuntime("viem");
const response = await fetch(manifestUrl, { signal: AbortSignal.timeout(10_000) });
if (!response.ok) throw new Error(`Fixture manifest returned HTTP ${response.status} from ${manifestUrl}`);
const manifest = await response.json();

if (!isObject(manifest)) throw new Error("Fixture manifest is not an object");
assertExactKeys(manifest, [
  "contract_version",
  "service_name",
  "mcp_endpoint",
  "tool",
  "mode",
  "sample_input",
  "assertions",
  "max_latency_ms",
  "delivery_type",
  "payment_mode",
  ...(expectedPaymentMode === "x402_optional" ? ["payment"] : []),
  "safe_use",
  "source_revision",
  "challenge_profile",
  "provider_address",
  "fixture",
  "declaration_signature",
]);

if (manifest.contract_version !== "1.0") throw new Error("Fixture contract_version is not 1.0");
if (manifest.service_name !== `LaunchProof Invoice Normalizer (${expectedVariant})`) throw new Error("Fixture service_name does not match its controlled variant");
if (manifest.mcp_endpoint !== `${baseUrl.origin}/mcp`) throw new Error("Fixture MCP endpoint does not match its explicit public URL");
if (manifest.tool !== "normalize_invoice" || manifest.mode !== "sample_only") throw new Error("Fixture tool or mode differs from the controlled contract");
deepStrictEqual(manifest.sample_input, { invoice_text: "Invoice #101, total USD 42.00, due 2026-07-31" });
deepStrictEqual(manifest.assertions, [
  { path: "$.invoice_number", rule: "equals", value: "101" },
  { path: "$.currency", rule: "equals", value: "USD" },
  { path: "$.total", rule: "equals", value: 42 },
  { path: "$.confidence", rule: "gte", value: 0.9 },
]);
if (manifest.max_latency_ms !== 8000 || manifest.delivery_type !== "synchronous_json") {
  throw new Error("Fixture latency or delivery declaration differs from the controlled contract");
}
if (manifest.payment_mode !== expectedPaymentMode) throw new Error("Fixture payment mode does not match the expected mode");
if (expectedPaymentMode === "none") {
  if (Object.hasOwn(manifest, "payment")) throw new Error("Unpaid fixture must not declare payment terms");
} else {
  if (!isObject(manifest.payment)) throw new Error("Paid fixture is missing payment terms");
  assertExactKeys(manifest.payment, ["network", "asset", "amount", "recipient", "resource_url"]);
  if (manifest.payment.network !== expectedNetwork) throw new Error("Fixture payment network does not match the expected network");
  if (manifest.payment.asset.toLowerCase() !== expectedAsset.toLowerCase()) throw new Error("Fixture payment asset does not match the expected asset");
  if (manifest.payment.amount !== expectedAmount) throw new Error("Fixture payment amount does not match the expected atomic amount");
  if (manifest.payment.recipient.toLowerCase() !== expectedRecipient.toLowerCase()) throw new Error("Fixture payment recipient does not match the expected recipient");
  if (manifest.payment.resource_url !== `${baseUrl.origin}/paid/mcp`) throw new Error("Fixture paid resource does not match its explicit public URL");
}
deepStrictEqual(manifest.safe_use, [
  "tool is read-only for synthetic sample data",
  "no credentials or account",
  "no tool side effect beyond the declared x402 payment",
]);
if (manifest.source_revision.toLowerCase() !== expectedRevision.toLowerCase()) throw new Error("Fixture source revision does not match the checked-out commit");
deepStrictEqual(manifest.challenge_profile, {
  name: "structured-extraction-v1",
  tool: "normalize_invoice",
  input_field: "document_text",
  output_fields: ["document_id", "currency", "total", "due_date"],
  challenge_runs: 3,
  max_latency_ms_per_run: 8000,
  safe_mode: "synthetic_read_only",
});
if (manifest.fixture !== true) throw new Error("Fixture manifest is not explicitly labeled");
if (!isAddress(manifest.provider_address)) throw new Error("Fixture provider address is invalid");
if (!/^0x[0-9a-fA-F]{130}$/.test(manifest.declaration_signature ?? "")) throw new Error("Fixture declaration signature is missing or invalid");

const { declaration_signature: signature, ...signingBody } = manifest;
const manifestHash = `0x${createHash("sha256").update(canonicalize(signingBody)).digest("hex")}`;
const valid = await verifyMessage({
  address: manifest.provider_address,
  message: { raw: manifestHash },
  signature,
});
if (!valid) throw new Error("Fixture declaration signature is invalid");
process.stdout.write(
  `${JSON.stringify({
    fixture: true,
    variant: expectedVariant,
    service_name: manifest.service_name,
    provider_address: manifest.provider_address,
    source_revision: manifest.source_revision,
    payment_mode: manifest.payment_mode,
    manifest_hash: manifestHash,
    declaration_valid: true,
  })}\n`,
);

function isAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`Fixture manifest keys differ from the controlled contract: expected ${wanted.join(", ")}; received ${actual.join(", ")}`);
  }
}
