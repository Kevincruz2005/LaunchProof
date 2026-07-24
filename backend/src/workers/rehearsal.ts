import { randomBytes } from "node:crypto";
import pLimit from "p-limit";
import { verifyMessage } from "viem";
import type { Config } from "../config.js";
import { GENESIS_AMOUNT_ATOMIC, MAX_EVIDENCE_BYTES, RENEWAL_AMOUNT_ATOMIC } from "../config.js";
import { evaluateAssertions, compareChallenge, overallClassification } from "../assertions/engine.js";
import { generateChallenges, observedP95 } from "../challenges/generator.js";
import type {
  CanonicalEvidence,
  ChainReference,
  Gates,
  InvocationEvidence,
  PaymentReference,
  RehearsalRequest,
  RunRecord,
} from "../domain/types.js";
import { passportStatus } from "../domain/gates.js";
import { hashJcs, sha256, toJcs } from "../evidence/canonical.js";
import {
  manifestSigningBody,
  normalizeLaunchContractUrl,
  parseLaunchContract,
  safeUseClaimsValid,
  type LaunchContract,
} from "../launch-contract/schema.js";
import { fetchJson, ResponseLimitError } from "../security/safe-fetch.js";
import { McpTargetClient, SUPPORTED_MCP_PROTOCOL_VERSION, type ToolDescription } from "../mcp/target-client.js";
import type { Repository, StoredRun } from "../db/store.js";
import {
  PublicationOutcomeUnknownError,
  RegistryService,
  type EvidenceHashes,
} from "../chain/registry.js";
import { failedDeliveryEvidence, TargetPaymentService } from "../payments/target.js";
import {
  sanitizeEvidenceText,
  sanitizeEvidenceValue,
  sanitizeStructuredError,
  sanitizeToolOutput,
} from "../evidence/sanitize.js";
import { AlwaysLeader, type LeaderGuard } from "../leadership/leader.js";

const limitations = [
  "LaunchProof is not a security certification.",
  "A passport reflects a point-in-time rehearsal and is not a guarantee of future uptime or behavior.",
  "A LaunchProof passport is not OKX marketplace identity verification and is not issued or endorsed by OKX.",
  "HTTPS and MCP execution occurred off-chain; the registry is a single-writer attestation registry, not a decentralized oracle.",
];

function createRunId(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

function dailyCapacity(config: Pick<Config, "GLOBAL_RUN_LIMIT_PER_DAY">) {
  const timestamp = new Date().toISOString();
  return { since: `${timestamp.slice(0, 10)}T00:00:00.000Z`, limit: config.GLOBAL_RUN_LIMIT_PER_DAY };
}

function emptyInvocation(kind: InvocationEvidence["kind"], classification: InvocationEvidence["classification"]): InvocationEvidence {
  return {
    kind,
    index: 0,
    input: {},
    expected: null,
    output: null,
    comparisons: [],
    structured_error: null,
    latency_ms: 0,
    classification,
  };
}

function safeError(error: unknown): string {
  if (error instanceof ResponseLimitError) return sanitizeEvidenceText(error.message);
  if (error instanceof Error) return sanitizeEvidenceText(error.message);
  return "Unknown rehearsal failure";
}

function isTimeout(error: { message: string } | null, latency: number, max: number): boolean {
  return latency >= max || Boolean(error && /timeout|timed out|abort/i.test(error.message));
}

function serverIdentity(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  return {
    name: typeof input.name === "string" ? input.name : null,
    version: typeof input.version === "string" ? input.version : null,
  };
}

interface SchemaRequirements {
  required: string[];
  anyOf: string[][];
}

function schemaRequirements(schema: Record<string, unknown>): SchemaRequirements {
  let requiredFields: string[] = [];
  if (Array.isArray(schema.required)) {
    const fields = schema.required.filter((field): field is string => typeof field === "string");
    if (fields.length > 0) requiredFields = fields;
  }
  const alternatives: string[][] = [];
  if (Array.isArray(schema.anyOf)) {
    for (const branch of schema.anyOf) {
      if (!branch || typeof branch !== "object" || Array.isArray(branch)) continue;
      const required = (branch as Record<string, unknown>).required;
      if (!Array.isArray(required)) continue;
      const fields = required.filter((field): field is string => typeof field === "string");
      if (fields.length > 0) alternatives.push(fields);
    }
  }
  return { required: requiredFields, anyOf: alternatives };
}

function schemaAcceptsInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
  requirements: SchemaRequirements,
): boolean {
  const properties = schema.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
  const propertyMap = properties as Record<string, unknown>;
  if (!Object.entries(input).every(([field, value]) => propertyAcceptsValue(propertyMap[field], value))) return false;
  const topLevelRequired = requirements.required.every((field) => Object.hasOwn(input, field));
  const anyOfRequired = requirements.anyOf.length === 0 ||
    requirements.anyOf.some((required) => required.every((field) => Object.hasOwn(input, field)));
  return topLevelRequired && anyOfRequired;
}

export function schemaAcceptsBoundedInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>,
): boolean {
  return schemaAcceptsInput(schema, input, schemaRequirements(schema));
}

function propertyAcceptsValue(property: unknown, value: unknown): boolean {
  if (!property || typeof property !== "object" || Array.isArray(property)) return false;
  const definition = property as { type?: unknown; maxLength?: unknown; maximum?: unknown; minimum?: unknown };
  if (definition.type === "string") {
    return typeof value === "string" &&
      typeof definition.maxLength === "number" &&
      Number.isInteger(definition.maxLength) &&
      definition.maxLength > 0 &&
      definition.maxLength <= 5_000 &&
      value.length <= definition.maxLength;
  }
  if (definition.type === "integer") return typeof value === "number" && Number.isInteger(value) && numericBoundsAccept(definition, value);
  if (definition.type === "number") return typeof value === "number" && Number.isFinite(value) && numericBoundsAccept(definition, value);
  if (definition.type === "boolean") return typeof value === "boolean";
  return false;
}

function numericBoundsAccept(definition: { minimum?: unknown; maximum?: unknown }, value: number): boolean {
  return (typeof definition.minimum !== "number" || value >= definition.minimum) &&
    (typeof definition.maximum !== "number" || value <= definition.maximum);
}

function deterministicRemediation(
  gates: Gates,
  invocations: InvocationEvidence[],
  declaration: "verified" | "not_provided" | "invalid",
): string[] {
  const messages: string[] = [];
  if (gates.discoverable === "fail") messages.push("Possible cause (informational only): align tools/list with the declared tool and input fields.");
  if (gates.contract_correct === "fail") messages.push("Possible cause (informational only): correct the fixed sample output or return a bounded structured error for missing required input.");
  if (gates.fresh_challenge === "fail") {
    const classification = invocations.find((item) => item.classification)?.classification;
    messages.push(
      classification === "schema_drift"
        ? "Possible cause (informational only): restore the declared output field names and value types."
        : classification === "timeout"
          ? "Possible cause (informational only): reduce processing time below the declared per-run deadline."
          : "Possible cause (informational only): correct the structured field mapping for fresh inputs.",
    );
  }
  if (gates.safe_to_rehearse === "fail") messages.push("Possible cause (informational only): expose a credential-free, read-only synthetic sample mode.");
  if (gates.paid_delivery === "fail") messages.push("Possible cause (informational only): align the x402 network, asset, amount, recipient, resource, and returned run linkage.");
  if (declaration === "invalid") messages.push("Possible cause (informational only): sign the RFC 8785 manifest hash with the declared provider address.");
  return messages;
}

export class RehearsalService {
  private readonly limiter;
  private readonly registry;
  private readonly targetPayments;
  private readonly active = new Set<string>();

  constructor(
    private readonly config: Config,
    private readonly repository: Repository,
    private readonly leadership: LeaderGuard = new AlwaysLeader(),
  ) {
    this.limiter = pLimit(config.MAX_CONCURRENT_RUNS);
    this.registry = new RegistryService(config, leadership);
    this.targetPayments = new TargetPaymentService(config, repository, leadership);
  }

  async start(request: RehearsalRequest, waitForCompletion: boolean): Promise<StoredRun> {
    const reserved = await this.reserve(
      request.url,
      request.idempotency_key,
      request.previous_run_id ? "renewal" : "genesis",
      request.previous_run_id ?? null,
    );
    if ("canonical_evidence" in reserved || reserved.state !== "payment_required") return reserved;
    return this.runReserved(reserved.run_id, request, waitForCompletion);
  }

  async reserve(
    url: string,
    idempotencyKey: string,
    operation: "genesis" | "renewal" = "genesis",
    previousRunId: string | null = null,
  ): Promise<StoredRun> {
    const target = normalizeLaunchContractUrl(url);
    const existing = await this.repository.getByIdempotencyKey(idempotencyKey);
    if (existing) {
      this.assertIdempotencySemantics(existing, target, operation, previousRunId);
      return existing;
    }
    const runId = createRunId();
    const timestamp = new Date().toISOString();
    const stored = await this.repository.createProgress({
      run_id: runId,
      idempotency_key: idempotencyKey,
      state: "payment_required",
      target,
      operation,
      previous_run_id: previousRunId,
      payment: null,
      created_at: timestamp,
      updated_at: timestamp,
      error: null,
    });
    this.assertIdempotencySemantics(stored, target, operation, previousRunId);
    return stored;
  }

  async runReserved(runId: string, request: RehearsalRequest, waitForCompletion: boolean): Promise<StoredRun> {
    await this.leadership.assertLeader("run-execution");
    if (this.active.has(runId)) return (await this.repository.getRun(runId))!;
    this.active.add(runId);
    try {
      this.validateLaunchPayment(request);
      await this.repository.authorizeRun(request.payment, runId, dailyCapacity(this.config));
      await this.repository.updateState(runId, "queued");
      const task = this.limiter(() => this.execute(runId, request)).finally(() => this.active.delete(runId));
      if (waitForCompletion) {
        await task;
        return (await this.repository.getRun(runId))!;
      }
      void task.catch(() => undefined);
      return (await this.repository.getRun(runId))!;
    } catch (error) {
      this.active.delete(runId);
      throw error;
    }
  }

  async recoverPendingRuns(): Promise<number> {
    await this.leadership.assertLeader("run-recovery");
    const runs = await this.repository.recoverableRuns();
    let recovered = 0;
    for (const run of runs) {
      if (!run.payment) continue;
      await this.runReserved(
        run.run_id,
        {
          url: run.target,
          idempotency_key: run.idempotency_key,
          payment: run.payment,
          ...(run.previous_run_id ? { previous_run_id: run.previous_run_id } : {}),
        },
        true,
      );
      recovered += 1;
    }
    return recovered;
  }

  private assertIdempotencySemantics(
    stored: StoredRun,
    target: string,
    operation: "genesis" | "renewal",
    previousRunId: string | null,
  ): void {
    const existingTarget = "canonical_evidence" in stored ? stored.canonical_evidence.target : stored.target;
    const existingPrevious = "canonical_evidence" in stored ? stored.previous_run_id : stored.previous_run_id;
    const existingOperation = "canonical_evidence" in stored
      ? (stored.previous_run_id ? "renewal" : "genesis")
      : stored.operation;
    if (existingTarget !== target || existingOperation !== operation || existingPrevious !== previousRunId) {
      throw new Error("Idempotency key is already bound to a different target, operation, or renewal lineage");
    }
  }

  private validateLaunchPayment(request: RehearsalRequest): void {
    if (request.payment.kind !== "launchproof") throw new Error("Run authorization must be a LaunchProof payment");
    if (request.payment.network !== this.config.chain.network) throw new Error("LaunchProof payment network does not match the active chain");
    if (request.payment.asset.toLowerCase() !== this.config.chain.usdt0Address.toLowerCase()) {
      throw new Error("LaunchProof payment asset does not match the active chain");
    }
    const expectedAmount = request.previous_run_id ? RENEWAL_AMOUNT_ATOMIC : GENESIS_AMOUNT_ATOMIC;
    if (request.payment.amount_atomic !== expectedAmount || request.payment.amount !== expectedAmount) {
      throw new Error("LaunchProof payment amount does not match the requested operation");
    }
    if (this.config.X402_ENABLED) {
      if (request.payment.status !== "settled" || !request.payment.settlement_transaction) {
        throw new Error("A final on-chain x402 settlement is required");
      }
      if (!this.config.PAYOUT_ADDRESS || request.payment.recipient?.toLowerCase() !== this.config.PAYOUT_ADDRESS.toLowerCase()) {
        throw new Error("LaunchProof payment recipient does not match the configured payout wallet");
      }
      return;
    }
    if (!this.config.ALLOW_LOCAL_UNPAID_RUNS || request.payment.status !== "local_only") {
      throw new Error("Local unpaid execution is not authorized");
    }
  }

  private async execute(runId: string, request: RehearsalRequest): Promise<void> {
    const runStarted = performance.now();
    let manifest: LaunchContract | null = null;
    let targetPayment: PaymentReference | null = null;
    let paidDeliveryEvidence: InvocationEvidence | null = null;
    let declarationState: "verified" | "not_provided" | "invalid" = "not_provided";
    try {
      await this.repository.updateState(runId, "fetching_contract");
      const raw = await fetchJson<unknown>(normalizeLaunchContractUrl(request.url), this.config);
      manifest = parseLaunchContract(raw, this.config);
      if (Buffer.byteLength(toJcs(manifest)) > 24_576) {
        throw new Error("Launch Contract exceeds the bounded evidence profile");
      }
      const manifestHash = hashJcs(manifestSigningBody(manifest));
      if (manifest.declaration_signature) {
        const valid = await verifyMessage({
          address: manifest.provider_address as `0x${string}`,
          message: { raw: manifestHash },
          signature: manifest.declaration_signature as `0x${string}`,
        });
        declarationState = valid ? "verified" : "invalid";
      }
      const sourceOrigin = new URL(normalizeLaunchContractUrl(request.url)).hostname.toLowerCase();
      if (new URL(manifest.mcp_endpoint).hostname.toLowerCase() !== sourceOrigin) {
        throw new Error("Launch Contract and MCP endpoint must use the same consenting provider hostname");
      }
      if (manifest.payment && new URL(manifest.payment.resource_url).hostname.toLowerCase() !== sourceOrigin) {
        throw new Error("Paid resource must use the same consenting provider hostname");
      }
      const fixtureVariant = this.trustedFixtureVariant(request.url, manifest);
      if (manifest.fixture && !fixtureVariant) {
        throw new Error("Untrusted provider cannot self-assert the LaunchProof fixture label");
      }
      if (fixtureVariant && declarationState !== "verified") {
        throw new Error("Configured fixture requires a valid provider declaration signature");
      }
      if (fixtureVariant && manifest.source_revision.toLowerCase() !== this.config.BUILD_COMMIT_SHA.toLowerCase()) {
        throw new Error("Trusted fixture source_revision must equal the running LaunchProof build commit");
      }

      if (request.previous_run_id) {
        const previous = await this.repository.getRun(request.previous_run_id);
        if (!previous || !("canonical_evidence" in previous)) throw new Error("Renewal previous_run_id was not found");
        if (
          previous.canonical_evidence.target !== normalizeLaunchContractUrl(request.url) ||
          previous.provider_declaration.provider_address.toLowerCase() !== manifest.provider_address.toLowerCase() ||
          previous.canonical_evidence.manifest.service_name !== manifest.service_name ||
          previous.canonical_evidence.manifest.tool !== manifest.tool
        ) {
          throw new Error("Renewal must preserve target, provider, service, and tool identity");
        }
        if (previous.manifest_hash === manifestHash && previous.source_version_sha === manifest.source_revision) {
          throw new Error("Renewal requires a changed manifest or source revision");
        }
      }

      const gates: Gates = {
        discoverable: "not_tested",
        contract_correct: "not_tested",
        fresh_challenge: "not_tested",
        safe_to_rehearse: "not_tested",
        paid_delivery: "not_tested",
      };
      const client = new McpTargetClient(manifest.mcp_endpoint, this.config, manifest.max_latency_ms, runStarted + 30_000);
      const latencies: number[] = [];
      const allInvocations: InvocationEvidence[] = [];

      await this.repository.updateState(runId, "discovering");
      const initialization = await client.initialize();
      const tools = await client.listTools();
      const declaredTool = tools.find((tool) => tool.name === manifest!.tool);
      const toolsCapability = initialization.protocolVersion === SUPPORTED_MCP_PROTOCOL_VERSION &&
        Boolean(initialization.capabilities.tools);
      const schemaMatches = Boolean(declaredTool && this.schemaMatches(declaredTool, manifest));
      gates.discoverable = toolsCapability && schemaMatches ? "pass" : "fail";
      const discovery = {
        protocol_version: typeof initialization.protocolVersion === "string"
          ? sanitizeEvidenceText(initialization.protocolVersion)
          : null,
        server_info: sanitizeEvidenceValue(serverIdentity(initialization.serverInfo)),
        server_capabilities: sanitizeEvidenceValue(initialization.capabilities),
        declared_tool: declaredTool
          ? {
              name: declaredTool.name,
              description: declaredTool.description ? sanitizeEvidenceText(declaredTool.description) : null,
              input_schema: declaredTool.inputSchema,
              input_schema_hash: hashJcs(declaredTool.inputSchema),
            }
          : null,
        tools_capability: toolsCapability,
        schema_matches: schemaMatches,
      };

      await this.repository.updateState(runId, "fixed_sample");
      const fixedStarted = performance.now();
      const fixedResult = await client.callTool(manifest.tool, manifest.sample_input);
      const fixedLatency = Math.round(performance.now() - fixedStarted);
      latencies.push(fixedLatency);
      const evidenceFields = [
        ...manifest.assertions.map((assertion) => assertion.path.slice(2)),
        ...manifest.challenge_profile.output_fields,
      ];
      const fixedOutput = sanitizeToolOutput(fixedResult.output, evidenceFields);
      const fixedError = sanitizeStructuredError(fixedResult.structuredError);
      const fixedComparisons = fixedOutput ? evaluateAssertions(fixedOutput, manifest.assertions) : [];
      const fixedClassification = isTimeout(fixedResult.structuredError, fixedLatency, manifest.max_latency_ms)
        ? "timeout"
        : fixedOutput
          ? overallClassification(fixedComparisons)
          : "schema_drift";
      const fixed: InvocationEvidence = {
        kind: "fixed_sample",
        index: 0,
        input: manifest.sample_input,
        expected: Object.fromEntries(manifest.assertions.map((item) => [item.path.slice(2), item.value])),
        output: fixedOutput,
        comparisons: fixedComparisons,
        structured_error: fixedError,
        latency_ms: fixedLatency,
        classification: fixedClassification,
      };
      allInvocations.push(fixed);

      await this.repository.updateState(runId, "invalid_input");
      const controlledInvalidInput = this.invalidInput(declaredTool, manifest.sample_input);
      const invalidStarted = performance.now();
      const invalidResult = await client.callTool(manifest.tool, controlledInvalidInput);
      const invalidLatency = Math.round(performance.now() - invalidStarted);
      latencies.push(invalidLatency);
      const invalidError = sanitizeStructuredError(invalidResult.structuredError);
      const invalidOutput = sanitizeToolOutput(invalidResult.output, evidenceFields);
      const message = invalidError?.message ?? "";
      const safeStructuredFailure = Boolean(
        invalidError &&
          invalidError.code === "TOOL_ERROR" &&
          !invalidOutput &&
          !isTimeout(invalidError, invalidLatency, manifest.max_latency_ms) &&
          message.length <= 500 &&
          !/stack|trace|secret|private[_ -]?key|api[_ -]?key|bearer\s/i.test(message),
      );
      const invalid: InvocationEvidence = {
        kind: "invalid_input",
        index: 0,
        input: controlledInvalidInput,
        expected: null,
        output: invalidOutput,
        comparisons: [],
        structured_error: invalidError,
        latency_ms: invalidLatency,
        classification: safeStructuredFailure ? null : "unsafe_error",
      };
      allInvocations.push(invalid);
      gates.contract_correct =
        fixedClassification === null &&
        fixedComparisons.length > 0 &&
        fixedComparisons.every((item) => item.match) &&
        safeStructuredFailure
          ? "pass"
          : "fail";
      gates.safe_to_rehearse =
        gates.discoverable === "pass" && this.safeUseDeclared(manifest) && safeStructuredFailure
          ? "pass"
          : "fail";

      await this.repository.updateState(runId, "fresh_challenges");
      const generatedAt = new Date().toISOString();
      const challenges = generateChallenges(manifest.challenge_profile.input_field, 3);
      for (const [index, challenge] of challenges.entries()) {
        const started = performance.now();
        const result = await client.callTool(manifest.tool, challenge.input);
        const latency = Math.round(performance.now() - started);
        latencies.push(latency);
        const output = sanitizeToolOutput(result.output, manifest.challenge_profile.output_fields);
        const structuredError = sanitizeStructuredError(result.structuredError);
        const comparisons = output
          ? compareChallenge(challenge.expected, output, manifest.challenge_profile.output_fields)
          : [];
        const classification = isTimeout(result.structuredError, latency, manifest.challenge_profile.max_latency_ms_per_run)
          ? "timeout"
          : output
            ? overallClassification(comparisons)
            : "schema_drift";
        allInvocations.push({
          kind: "challenge",
          index,
          input: challenge.input,
          expected: challenge.expected,
          output,
          comparisons,
          structured_error: structuredError,
          latency_ms: latency,
          classification,
        });
      }
      const challengeInvocations = allInvocations.filter((item) => item.kind === "challenge");
      gates.fresh_challenge =
        challengeInvocations.length === 3 &&
        challengeInvocations.every((item) => item.classification === null && item.comparisons.every((comparison) => comparison.match))
          ? "pass"
          : "fail";

      if (Buffer.byteLength(toJcs({ manifest, discovery, invocations: allInvocations })) > 49_152) {
        throw new Error("Bounded rehearsal evidence would exceed the on-chain profile");
      }

      await this.repository.updateState(runId, "target_payment_or_not_tested");
      if (manifest.payment_mode === "x402_optional") {
        try {
          if (request.payment.status !== "settled") throw new Error("Paid target delivery requires a settled LaunchProof authorization");
          if (declarationState !== "verified") throw new Error("Paid target delivery requires a verified provider declaration");
          const paidDelivery = await this.targetPayments.pay(manifest, runId);
          targetPayment = paidDelivery.payment;
          paidDeliveryEvidence = paidDelivery.evidence;
          latencies.push(paidDelivery.evidence.latency_ms);
          gates.paid_delivery = paidDelivery.deliveryMatches ? "pass" : "fail";
        } catch (error) {
          const progress = await this.repository.getRun(runId);
          if (progress && !("canonical_evidence" in progress) && progress.target_payment_attempt) {
            // A signed EIP-3009 authorization may already have reached the
            // facilitator. Keep the durable attempt recoverable and do not
            // overwrite it with a finalized Passport.
            throw error;
          }
          const failureEvidence = failedDeliveryEvidence(runId, manifest, safeError(error));
          paidDeliveryEvidence = failureEvidence;
          latencies.push(failureEvidence.latency_ms);
          gates.paid_delivery = "fail";
        }
      }

      await this.repository.updateState(runId, "canonicalizing");
      const status = passportStatus(gates, true);
      const remediation = deterministicRemediation(gates, allInvocations, declarationState);
      const normalizedComparisons = allInvocations.flatMap((invocation) => invocation.comparisons);
      const generated = new Date().toISOString();
      const totalMs = Math.round(performance.now() - runStarted);
      if (totalMs > 30_000) throw new Error("Complete rehearsal exceeded the 30 second deadline");
      const evidence: CanonicalEvidence = {
        schema_version: "1.0",
        run_id: runId,
        target: normalizeLaunchContractUrl(request.url),
        label: fixtureVariant && declarationState === "verified" ? "fixture" : "external",
        network: this.config.chain.network,
        execution_mode: request.payment.status === "settled" && this.config.chainReady ? "testnet" : "local",
        generated_at: generated,
        manifest,
        discovery,
        fixed_sample: fixed,
        invalid_input: invalid,
        challenges: challengeInvocations,
        paid_delivery: paidDeliveryEvidence,
        timings: { invocation_ms: latencies, total_ms: totalMs, observed_p95_ms: observedP95(latencies) },
        gates,
        passport_status: status,
        provider_declaration: {
          provider_address: manifest.provider_address,
          manifest_hash: manifestHash,
          signature: manifest.declaration_signature ?? null,
          verification_state: declarationState,
        },
        payments: { launchproof: request.payment, target: targetPayment },
        hash_material: {
          inputs: [fixed.input, invalid.input, ...challengeInvocations.map((item) => item.input), ...paidDeliveryEvidence ? [paidDeliveryEvidence.input] : []],
          normalized_comparisons: [...normalizedComparisons, ...(paidDeliveryEvidence?.comparisons ?? [])],
        },
        source_revision: manifest.source_revision,
        build_commit: this.config.BUILD_COMMIT_SHA,
        previous_run_id: request.previous_run_id ?? null,
        remediation,
        limitations,
      };
      const canonical = toJcs(evidence);
      if (Buffer.byteLength(canonical) > MAX_EVIDENCE_BYTES) throw new Error("Normalized evidence exceeds the 64 KiB on-chain limit");
      const hashes = {
        evidenceHash: sha256(canonical),
        manifestHash,
        inputHash: hashJcs(evidence.hash_material.inputs),
        normalizedResultHash: hashJcs(evidence.hash_material.normalized_comparisons),
      };
      await this.repository.updateState(runId, "publishing_on_chain");
      const chain = await this.registry.publish(evidence, hashes, async (transactionHash) => {
        const candidate = runRecordFromEvidence({
          runId,
          idempotencyKey: request.idempotency_key,
          evidence,
          canonical,
          hashes,
          state: "publishing_on_chain",
          chain: pendingChain(this.config, transactionHash),
        });
        await this.repository.recordPublicationAttempt(runId, {
          transaction_hash: transactionHash,
          evidence_hash: hashes.evidenceHash,
          started_at: new Date().toISOString(),
          candidate,
        });
      });
      if (request.payment.status === "settled" && this.config.chainReady && !chain.published) {
        throw new Error("Chain-ready settled run was not published on chain");
      }
      const record = runRecordFromEvidence({
        runId,
        idempotencyKey: request.idempotency_key,
        evidence,
        canonical,
        hashes,
        state: chain.published ? "complete" : "complete_local",
        chain,
      });
      await this.repository.saveRun(record);
      await this.repository.savePayment(request.payment, runId);
      if (targetPayment) await this.repository.savePayment(targetPayment, runId);
    } catch (error) {
      const message = safeError(error);
      if (error instanceof PublicationOutcomeUnknownError) {
        await this.repository.updateState(runId, "publishing_on_chain", message);
        throw error;
      }
      await this.repository.updateState(runId, "failed", message);
      if (manifest) {
        targetPayment ??= await this.repository.getTargetPaymentForRun(runId).catch(() => null);
        await this.publishNotRehearsable(runId, request, manifest, declarationState, message, targetPayment).catch(() => undefined);
      }
      throw error;
    }
  }

  private schemaMatches(tool: ToolDescription, manifest: LaunchContract): boolean {
    if (tool.inputSchema.type !== "object" || tool.inputSchema.additionalProperties !== false) return false;
    const properties = tool.inputSchema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
    const requirements = schemaRequirements(tool.inputSchema);
    if (requirements.required.length === 0 && requirements.anyOf.length === 0) return false;
    return schemaAcceptsBoundedInput(tool.inputSchema, manifest.sample_input) &&
      schemaAcceptsBoundedInput(tool.inputSchema, {
        [manifest.challenge_profile.input_field]: "Synthetic bounded invoice",
      });
  }

  private invalidInput(tool: ToolDescription | undefined, sample: Record<string, unknown>): Record<string, unknown> {
    const invalid = structuredClone(sample);
    if (!tool) {
      const first = Object.keys(invalid)[0];
      if (first) delete invalid[first];
      return invalid;
    }
    const requirements = schemaRequirements(tool.inputSchema);
    for (const field of Object.keys(invalid)) {
      const candidate = structuredClone(invalid);
      delete candidate[field];
      if (!schemaAcceptsInput(tool.inputSchema, candidate, requirements)) return candidate;
    }
    const first = Object.keys(invalid)[0];
    if (first) delete invalid[first];
    return invalid;
  }

  private safeUseDeclared(manifest: LaunchContract): boolean {
    return safeUseClaimsValid(manifest.safe_use) &&
      manifest.mode === "sample_only" &&
      manifest.challenge_profile.safe_mode === "synthetic_read_only";
  }

  private trustedFixtureVariant(requestUrl: string, manifest: LaunchContract): string | null {
    for (const [variant, configuredUrl] of Object.entries(this.config.fixtureUrls)) {
      const provider = this.config.fixtureAddresses[variant as keyof Config["fixtureAddresses"]];
      if (!configuredUrl || !provider) continue;
      if (
        normalizeLaunchContractUrl(configuredUrl) === normalizeLaunchContractUrl(requestUrl) &&
        provider.toLowerCase() === manifest.provider_address.toLowerCase()
      ) return variant;
    }
    return null;
  }

  private async publishNotRehearsable(
    runId: string,
    request: RehearsalRequest,
    manifest: LaunchContract,
    declarationState: "verified" | "not_provided" | "invalid",
    reason: string,
    targetPayment: PaymentReference | null,
  ) {
    const gates: Gates = {
      discoverable: "not_tested",
      contract_correct: "not_tested",
      fresh_challenge: "not_tested",
      safe_to_rehearse: "not_tested",
      paid_delivery: "not_tested",
    };
    const manifestHash = hashJcs(manifestSigningBody(manifest));
    const placeholder = emptyInvocation("fixed_sample", null);
    const invalid = emptyInvocation("invalid_input", null);
    const generated = new Date().toISOString();
    const evidence: CanonicalEvidence = {
      schema_version: "1.0",
      run_id: runId,
      target: normalizeLaunchContractUrl(request.url),
      label: this.trustedFixtureVariant(request.url, manifest) && declarationState === "verified" ? "fixture" : "external",
      network: this.config.chain.network,
      execution_mode: request.payment.status === "settled" && this.config.chainReady ? "testnet" : "local",
      generated_at: generated,
      manifest,
      discovery: { infrastructure_error: sanitizeEvidenceText(reason) },
      fixed_sample: placeholder,
      invalid_input: invalid,
      challenges: [],
      paid_delivery: null,
      timings: { invocation_ms: [], total_ms: 0, observed_p95_ms: 0 },
      gates,
      passport_status: "not-rehearsable",
      provider_declaration: {
        provider_address: manifest.provider_address,
        manifest_hash: manifestHash,
        signature: manifest.declaration_signature ?? null,
        verification_state: declarationState,
      },
      payments: { launchproof: request.payment, target: targetPayment },
      hash_material: { inputs: [], normalized_comparisons: [] },
      source_revision: manifest.source_revision,
      build_commit: this.config.BUILD_COMMIT_SHA,
      previous_run_id: request.previous_run_id ?? null,
      remediation: [`Possible cause (informational only): ${reason}`],
      limitations,
    };
    const canonical = toJcs(evidence);
    if (Buffer.byteLength(canonical) > MAX_EVIDENCE_BYTES) return;
    const hashes = {
      evidenceHash: sha256(canonical),
      manifestHash,
      inputHash: hashJcs([]),
      normalizedResultHash: hashJcs([]),
    };
    const chain = await this.registry.publish(evidence, hashes, async (transactionHash) => {
      const candidate = runRecordFromEvidence({
        runId,
        idempotencyKey: request.idempotency_key,
        evidence,
        canonical,
        hashes,
        state: "publishing_on_chain",
        chain: pendingChain(this.config, transactionHash),
      });
      await this.repository.recordPublicationAttempt(runId, {
        transaction_hash: transactionHash,
        evidence_hash: hashes.evidenceHash,
        started_at: new Date().toISOString(),
        candidate,
      });
    });
    if (!chain.published) return;
    await this.repository.saveRun(runRecordFromEvidence({
      runId,
      idempotencyKey: request.idempotency_key,
      evidence,
      canonical,
      hashes,
      state: "complete",
      chain,
    }));
    await this.repository.savePayment(request.payment, runId);
    if (targetPayment) await this.repository.savePayment(targetPayment, runId);
  }
}

function runRecordFromEvidence(input: {
  runId: string;
  idempotencyKey: string;
  evidence: CanonicalEvidence;
  canonical: string;
  hashes: EvidenceHashes;
  state: RunRecord["state"];
  chain: ChainReference;
}): RunRecord {
  return {
    run_id: input.runId,
    idempotency_key: input.idempotencyKey,
    state: input.state,
    previous_run_id: input.evidence.previous_run_id,
    label: input.evidence.label,
    scope: "structured-extraction-v1 only",
    passport_status: input.evidence.passport_status,
    gates: input.evidence.gates,
    canonical_evidence: input.evidence,
    canonical_evidence_jcs: input.canonical,
    evidence_hash: input.hashes.evidenceHash,
    manifest_hash: input.hashes.manifestHash,
    input_hash: input.hashes.inputHash,
    normalized_result_hash: input.hashes.normalizedResultHash,
    source_version_sha: input.evidence.source_revision,
    build_commit_sha: input.evidence.build_commit,
    generated_at: input.evidence.generated_at,
    provider_declaration: input.evidence.provider_declaration,
    payment: input.evidence.payments.launchproof,
    target_payment: input.evidence.payments.target,
    chain: input.chain,
    remediation: input.evidence.remediation,
    limitations: input.evidence.limitations,
  };
}

function pendingChain(config: Config, transactionHash: `0x${string}`): ChainReference {
  return {
    registry_address: config.REGISTRY_ADDRESS!,
    evidence_transaction_hash: transactionHash,
    block_number: "0",
    explorer_url: `${config.chain.explorerUrl}/tx/${transactionHash}`,
    published: false,
  };
}
