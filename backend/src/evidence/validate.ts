import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";
import type { Config } from "../config.js";
import { passportStatus } from "../domain/gates.js";
import type { CanonicalEvidence, FieldComparison, Gates, InvocationEvidence, PaymentReference } from "../domain/types.js";
import {
  manifestSigningBody,
  parseLaunchContract,
  safeUseClaimsValid,
} from "../launch-contract/schema.js";
import { hashJcs, toJcs } from "./canonical.js";
import { SUPPORTED_MCP_PROTOCOL_VERSION } from "../mcp/target-client.js";

const bytes32 = z.string().regex(/^0x(?!0{64}$)[0-9a-fA-F]{64}$/);
const address = z.string().regex(/^0x(?!0{40}$)[0-9a-fA-F]{40}$/);
const gitCommit = z.string().regex(/^[0-9a-fA-F]{40}$/);
const isoDate = z.string().datetime({ offset: true });
const primitive = z.union([z.string().max(5_000), z.number().finite(), z.boolean(), z.null()]);
const primitiveRecord = z.record(z.string().min(1).max(100), primitive).superRefine((value, context) => {
  if (Object.keys(value).length > 30) context.addIssue({ code: "custom", message: "too many evidence fields" });
});
const classification = z.enum(["invalid_output", "schema_drift", "timeout", "unsafe_error"]).nullable();

const comparisonSchema = z.object({
  field: z.string().min(1).max(100),
  expected: primitive,
  actual: primitive,
  match: z.boolean(),
  classification,
}).strict();

const invocationSchema = z.object({
  kind: z.enum(["fixed_sample", "invalid_input", "challenge", "paid_delivery"]),
  index: z.number().int().min(0).max(3),
  input: primitiveRecord,
  expected: primitiveRecord.nullable(),
  output: primitiveRecord.nullable(),
  comparisons: z.array(comparisonSchema).max(20),
  structured_error: z.object({
    code: z.union([z.string().max(100), z.number().finite()]),
    message: z.string().max(500),
  }).strict().nullable(),
  latency_ms: z.number().int().min(0).max(30_000),
  classification,
}).strict();

const paymentSchema = z.object({
  payment_id: z.string().min(1).max(100),
  kind: z.enum(["launchproof", "target"]),
  amount: z.string().regex(/^[0-9]+$/),
  amount_atomic: z.string().regex(/^[0-9]+$/),
  amount_display: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/),
  asset_decimals: z.number().int().min(0).max(255),
  asset: address,
  network: z.string().regex(/^eip155:[1-9][0-9]*$/),
  payer: address.nullable(),
  recipient: address.nullable(),
  route: z.string().min(1).max(2_048),
  settlement_transaction: bytes32.nullable(),
  status: z.enum(["settled", "not_tested", "local_only"]),
  timestamp: isoDate,
}).strict();

const gatesSchema = z.object({
  discoverable: z.enum(["pass", "fail", "not_tested"]),
  contract_correct: z.enum(["pass", "fail", "not_tested"]),
  fresh_challenge: z.enum(["pass", "fail", "not_tested"]),
  safe_to_rehearse: z.enum(["pass", "fail", "not_tested"]),
  paid_delivery: z.enum(["pass", "fail", "not_tested"]),
}).strict();

const evidenceSchema = z.object({
  schema_version: z.literal("1.0"),
  run_id: bytes32,
  target: z.string().url().max(2_048),
  label: z.enum(["fixture", "external"]),
  network: z.string().regex(/^eip155:[1-9][0-9]*$/),
  execution_mode: z.enum(["local", "testnet", "mainnet"]),
  generated_at: isoDate,
  manifest: z.unknown(),
  discovery: z.record(z.string(), z.unknown()),
  fixed_sample: invocationSchema,
  invalid_input: invocationSchema,
  challenges: z.array(invocationSchema).max(3),
  paid_delivery: invocationSchema.nullable(),
  timings: z.object({
    invocation_ms: z.array(z.number().int().min(0).max(30_000)).max(6),
    total_ms: z.number().int().min(0).max(30_000),
    observed_p95_ms: z.number().int().min(0).max(30_000),
  }).strict(),
  gates: gatesSchema,
  passport_status: z.enum(["verified", "needs-attention", "not-rehearsable"]),
  provider_declaration: z.object({
    provider_address: address,
    manifest_hash: bytes32,
    signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).nullable(),
    verification_state: z.enum(["verified", "not_provided", "invalid"]),
  }).strict(),
  payments: z.object({
    launchproof: paymentSchema,
    target: paymentSchema.nullable(),
  }).strict(),
  hash_material: z.object({
    inputs: z.array(primitiveRecord).max(6),
    normalized_comparisons: z.array(comparisonSchema).max(80),
  }).strict(),
  source_revision: gitCommit,
  build_commit: gitCommit,
  previous_run_id: bytes32.nullable(),
  remediation: z.array(z.string().max(500)).max(20),
  limitations: z.array(z.string().max(500)).min(1).max(20),
}).strict();

export interface EvidenceSemanticResult {
  evidence: CanonicalEvidence;
  match: boolean;
}

/** Validates chain-loaded evidence independently of the database cache. */
export function validateCanonicalEvidence(
  input: unknown,
  config: Config,
  runId: string,
  anchoredAt: number,
): EvidenceSemanticResult | null {
  const parsed = evidenceSchema.safeParse(input);
  if (!parsed.success) return null;
  const evidence = parsed.data as CanonicalEvidence;
  let manifest;
  try {
    manifest = parseLaunchContract(evidence.manifest, { ALLOW_PRIVATE_TARGETS: false, chain: config.chain });
  } catch {
    return null;
  }

  const target = strictPublicUrl(evidence.target);
  const manifestEndpoint = strictPublicUrl(manifest.mcp_endpoint);
  const generatedAt = Date.parse(evidence.generated_at);
  if (!target || !manifestEndpoint || !Number.isFinite(generatedAt)) return null;
  const sameProviderOrigin = target.origin.toLowerCase() === manifestEndpoint.origin.toLowerCase() &&
    (!manifest.payment || target.origin.toLowerCase() === new URL(manifest.payment.resource_url).origin.toLowerCase());
  const manifestHash = hashJcs(manifestSigningBody(manifest));
  const fixtureMatch = configuredFixtureMatch(config, evidence.target, manifest.provider_address);
  const expectedFixture = evidence.label === "fixture";

  const launch = evidence.payments.launchproof;
  const targetPayment = evidence.payments.target;
  const expectedLaunchAmount = evidence.previous_run_id ? "100000" : "10000";
  const expectedLaunchDisplay = evidence.previous_run_id ? "0.10" : "0.01";
  const launchRouteMatches = evidence.previous_run_id
    ? launch.route === "/api/renewals" || launch.route === "/mcp/renew"
    : launch.route === "/api/rehearsals" || launch.route === "/mcp/rehearse";
  const launchMatches = launch.kind === "launchproof" &&
    launch.status === "settled" &&
    launch.amount === launch.amount_atomic &&
    launch.amount_atomic === expectedLaunchAmount &&
    launch.amount_display === expectedLaunchDisplay &&
    launch.asset_decimals === config.chain.usdt0Decimals &&
    launch.asset.toLowerCase() === config.chain.usdt0Address.toLowerCase() &&
    launch.network === config.chain.network &&
    Boolean(launch.payer && launch.recipient && launch.settlement_transaction) &&
    launch.payment_id.toLowerCase() === launch.settlement_transaction?.toLowerCase() &&
    launch.recipient?.toLowerCase() === config.PAYOUT_ADDRESS?.toLowerCase() &&
    launchRouteMatches;

  const targetMatches = targetPaymentMatches(config, manifest, targetPayment, launch);
  const paidDeliveryMatches = paidDeliveryEvidenceMatches(evidence, targetMatches);
  const targetEvidenceConsistent = targetPayment
    ? targetMatches
    : evidence.gates.paid_delivery !== "pass" && evidence.paid_delivery === null;
  const discovery = discoverySemantics(evidence, manifest.tool, manifest.sample_input, manifest.challenge_profile.input_field);
  const expectedGates = recomputeGates(evidence, manifest.payment_mode, paidDeliveryMatches, discovery.discoverable);
  const expectedStatus = passportStatus(expectedGates, evidence.passport_status !== "not-rehearsable");
  const invocations = [
    evidence.fixed_sample,
    evidence.invalid_input,
    ...evidence.challenges,
    ...(evidence.paid_delivery ? [evidence.paid_delivery] : []),
  ];
  const normalRun = evidence.passport_status !== "not-rehearsable";
  const expectedInputs = normalRun ? invocations.map((invocation) => invocation.input) : [];
  const expectedComparisons = normalRun ? invocations.flatMap((invocation) => invocation.comparisons) : [];
  const invocationTimes = invocations.map((invocation) => invocation.latency_ms);
  const timingMatches = normalRun
    ? toJcs(evidence.timings.invocation_ms) === toJcs(invocationTimes) &&
      evidence.timings.observed_p95_ms === observedP95(invocationTimes) &&
      evidence.timings.total_ms + 10 >= invocationTimes.reduce((total, value) => total + value, 0)
    : evidence.timings.invocation_ms.length === 0 && evidence.timings.observed_p95_ms === 0;

  const match = evidence.run_id.toLowerCase() === runId.toLowerCase() &&
    evidence.network === config.chain.network &&
    evidence.execution_mode === "testnet" &&
    generatedAt <= anchoredAt * 1_000 + 5 * 60_000 &&
    Date.parse(launch.timestamp) <= generatedAt + 5 * 60_000 &&
    (!targetPayment || Date.parse(targetPayment.timestamp) <= generatedAt + 5 * 60_000) &&
    sameProviderOrigin && discovery.match &&
    manifest.source_revision.toLowerCase() === evidence.source_revision.toLowerCase() &&
    evidence.provider_declaration.provider_address.toLowerCase() === manifest.provider_address.toLowerCase() &&
    evidence.provider_declaration.manifest_hash.toLowerCase() === manifestHash.toLowerCase() &&
    (expectedFixture ? fixtureMatch && manifest.fixture === true : !manifest.fixture) &&
    launchMatches && targetEvidenceConsistent &&
    paidDeliveryMatches === (evidence.gates.paid_delivery === "pass") &&
    toJcs(evidence.gates) === toJcs(expectedGates) &&
    evidence.passport_status === expectedStatus &&
    toJcs(evidence.hash_material.inputs) === toJcs(expectedInputs) &&
    toJcs(evidence.hash_material.normalized_comparisons) === toJcs(expectedComparisons) &&
    timingMatches &&
    invocationSemanticsMatch(evidence, normalRun) &&
    safeUseClaimsValid(manifest.safe_use);
  return { evidence, match };
}

function recomputeGates(
  evidence: CanonicalEvidence,
  paymentMode: "none" | "x402_optional",
  targetMatches: boolean,
  discoveryPass: boolean,
): Gates {
  if (evidence.passport_status === "not-rehearsable") {
    return {
      discoverable: "not_tested",
      contract_correct: "not_tested",
      fresh_challenge: "not_tested",
      safe_to_rehearse: "not_tested",
      paid_delivery: "not_tested",
    };
  }
  const discoverable = discoveryPass ? "pass" : "fail";
  const contractCorrect = evidence.fixed_sample.classification === null &&
    evidence.fixed_sample.comparisons.length > 0 &&
    evidence.fixed_sample.comparisons.every(comparisonPasses) &&
    evidence.invalid_input.classification === null &&
    evidence.invalid_input.structured_error?.code === "TOOL_ERROR"
      ? "pass" : "fail";
  const challengePass = evidence.challenges.length === 3 &&
    evidence.challenges.every((invocation) =>
      invocation.classification === null &&
      invocation.comparisons.length === 4 &&
      invocation.comparisons.every(comparisonPasses));
  const safe = discoverable === "pass" &&
    evidence.invalid_input.classification === null &&
    evidence.invalid_input.structured_error?.code === "TOOL_ERROR" &&
    safeUseClaimsValid(evidence.manifest.safe_use);
  return {
    discoverable,
    contract_correct: contractCorrect,
    fresh_challenge: challengePass ? "pass" : "fail",
    safe_to_rehearse: safe ? "pass" : "fail",
    paid_delivery: paymentMode === "none" ? "not_tested" : targetMatches ? "pass" : "fail",
  };
}

function discoverySemantics(
  evidence: CanonicalEvidence,
  expectedTool: string,
  sampleInput: Record<string, unknown>,
  challengeField: string,
): { match: boolean; discoverable: boolean } {
  if (evidence.passport_status === "not-rehearsable") return { match: true, discoverable: false };
  const discovery = evidence.discovery as Record<string, unknown>;
  const capabilities = asRecord(discovery.server_capabilities);
  const toolsCapability = discovery.protocol_version === SUPPORTED_MCP_PROTOCOL_VERSION && Boolean(asRecord(capabilities?.tools));
  const declared = asRecord(discovery.declared_tool);
  const schema = asRecord(declared?.input_schema);
  const schemaMatches = Boolean(
    declared?.name === expectedTool && schema &&
    declared?.input_schema_hash === hashJcs(schema) &&
    toolSchemaMatches(schema, sampleInput, challengeField),
  );
  return {
    match: discovery.tools_capability === toolsCapability && discovery.schema_matches === schemaMatches,
    discoverable: toolsCapability && schemaMatches,
  };
}

function toolSchemaMatches(
  schema: Record<string, unknown>,
  sampleInput: Record<string, unknown>,
  challengeField: string,
): boolean {
  if (schema.type !== "object" || schema.additionalProperties !== false) return false;
  const properties = asRecord(schema.properties);
  if (!properties) return false;
  const requirements = schemaRequirements(schema);
  if (requirements.required.length === 0 && requirements.anyOf.length === 0) return false;
  return schemaAccepts(schema, sampleInput, requirements) &&
    schemaAccepts(schema, { [challengeField]: "Synthetic bounded invoice" }, requirements);
}

function schemaRequirements(schema: Record<string, unknown>): { required: string[]; anyOf: string[][] } {
  const required = Array.isArray(schema.required)
    ? schema.required.filter((field): field is string => typeof field === "string")
    : [];
  const anyOf = Array.isArray(schema.anyOf)
    ? schema.anyOf.flatMap((branch) => {
        const fields = asRecord(branch)?.required;
        return Array.isArray(fields)
          ? [fields.filter((field): field is string => typeof field === "string")]
          : [];
      })
    : [];
  return { required, anyOf };
}

function schemaAccepts(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
  requirements: { required: string[]; anyOf: string[][] },
): boolean {
  const properties = asRecord(schema.properties);
  if (!properties || !Object.entries(input).every(([field, value]) => propertyAccepts(properties[field], value))) return false;
  return requirements.required.every((field) => Object.hasOwn(input, field)) &&
    (requirements.anyOf.length === 0 || requirements.anyOf.some((branch) => branch.every((field) => Object.hasOwn(input, field))));
}

function propertyAccepts(property: unknown, value: unknown): boolean {
  const definition = asRecord(property);
  if (!definition) return false;
  if (definition.type === "string") return typeof value === "string" &&
    typeof definition.maxLength === "number" && value.length <= definition.maxLength;
  if (definition.type === "integer") return typeof value === "number" && Number.isInteger(value) && numericBoundsAccept(definition, value);
  if (definition.type === "number") return typeof value === "number" && Number.isFinite(value) && numericBoundsAccept(definition, value);
  return definition.type === "boolean" && typeof value === "boolean";
}

function numericBoundsAccept(definition: Record<string, unknown>, value: number): boolean {
  return (typeof definition.minimum !== "number" || value >= definition.minimum) &&
    (typeof definition.maximum !== "number" || value <= definition.maximum);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function invocationSemanticsMatch(evidence: CanonicalEvidence, normalRun: boolean): boolean {
  if (!normalRun) {
    return evidence.fixed_sample.kind === "fixed_sample" &&
      evidence.invalid_input.kind === "invalid_input" &&
      evidence.challenges.length === 0;
  }
  return evidence.fixed_sample.kind === "fixed_sample" && evidence.fixed_sample.index === 0 &&
    evidence.invalid_input.kind === "invalid_input" && evidence.invalid_input.index === 0 &&
    evidence.challenges.length === 3 &&
    evidence.challenges.every((item, index) => item.kind === "challenge" && item.index === index);
}

function comparisonPasses(comparison: FieldComparison): boolean {
  return comparison.match && comparison.classification === null;
}

function targetPaymentMatches(
  config: Config,
  manifest: CanonicalEvidence["manifest"],
  payment: PaymentReference | null,
  launch: PaymentReference,
): boolean {
  if (manifest.payment_mode === "none") return payment === null;
  if (!manifest.payment || !payment) return false;
  let expectedPayer: string | null = null;
  if (config.TARGET_PAYER_PRIVATE_KEY) {
    try {
      expectedPayer = privateKeyToAccount(config.TARGET_PAYER_PRIVATE_KEY as `0x${string}`).address;
    } catch {
      return false;
    }
  }
  return payment.kind === "target" && payment.status === "settled" &&
    payment.amount === payment.amount_atomic && payment.amount_atomic === manifest.payment.amount &&
    payment.amount_display === formatAtomic(manifest.payment.amount, config.chain.usdt0Decimals) &&
    payment.asset_decimals === config.chain.usdt0Decimals &&
    payment.asset.toLowerCase() === config.chain.usdt0Address.toLowerCase() &&
    payment.network === config.chain.network &&
    payment.route === manifest.payment.resource_url &&
    payment.recipient?.toLowerCase() === manifest.payment.recipient.toLowerCase() &&
    Boolean(payment.payer && payment.settlement_transaction) &&
    (!expectedPayer || payment.payer?.toLowerCase() === expectedPayer.toLowerCase()) &&
    payment.payment_id.toLowerCase() === payment.settlement_transaction?.toLowerCase() &&
    payment.settlement_transaction?.toLowerCase() !== launch.settlement_transaction?.toLowerCase();
}

function paidDeliveryEvidenceMatches(evidence: CanonicalEvidence, targetMatches: boolean): boolean {
  const delivery = evidence.paid_delivery;
  if (!delivery) return false;
  return targetMatches && delivery.kind === "paid_delivery" && delivery.index === 0 &&
    delivery.classification === null && delivery.structured_error === null &&
    delivery.expected?.run_id === evidence.run_id &&
    delivery.expected?.source_revision === evidence.source_revision &&
    delivery.output?.run_id === evidence.run_id &&
    delivery.output?.source_revision === evidence.source_revision &&
    delivery.comparisons.length === 2 && delivery.comparisons.every(comparisonPasses);
}

function configuredFixtureMatch(config: Config, target: string, provider: string): boolean {
  for (const [variant, configuredUrl] of Object.entries(config.fixtureUrls)) {
    if (!configuredUrl) continue;
    const configuredProvider = config.fixtureAddresses[variant as keyof Config["fixtureAddresses"]];
    if (!configuredProvider) continue;
    if (normalizeManifestUrl(configuredUrl) === normalizeManifestUrl(target) &&
      configuredProvider.toLowerCase() === provider.toLowerCase()) return true;
  }
  return false;
}

function normalizeManifestUrl(value: string): string {
  const url = new URL(value);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/.well-known/launch-contract.json";
  return url.toString();
}

function strictPublicUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url;
  } catch {
    return null;
  }
}

function observedP95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function formatAtomic(value: string, decimals: number): string {
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}
