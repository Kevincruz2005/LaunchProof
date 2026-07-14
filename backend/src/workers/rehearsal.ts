import { randomBytes } from "node:crypto";
import pLimit from "p-limit";
import { verifyMessage } from "viem";
import type { Config } from "../config.js";
import { MAX_EVIDENCE_BYTES } from "../config.js";
import { evaluateAssertions, compareChallenge, overallClassification } from "../assertions/engine.js";
import { generateChallenges, observedP95 } from "../challenges/generator.js";
import type {
  CanonicalEvidence,
  Gates,
  InvocationEvidence,
  PaymentReference,
  RehearsalRequest,
  RunRecord,
} from "../domain/types.js";
import { passportStatus } from "../domain/gates.js";
import { hashJcs, sha256, toJcs } from "../evidence/canonical.js";
import { LaunchContractSchema, manifestSigningBody, type LaunchContract } from "../launch-contract/schema.js";
import { fetchJson, ResponseLimitError } from "../security/safe-fetch.js";
import { McpTargetClient, type ToolDescription } from "../mcp/target-client.js";
import type { Repository, StoredRun } from "../db/store.js";
import { RegistryService } from "../chain/registry.js";
import { TargetPaymentService } from "../payments/target.js";

const limitations = [
  "LaunchProof is not a security certification.",
  "A passport reflects a point-in-time rehearsal and is not a guarantee of future uptime or behavior.",
  "A LaunchProof passport is not OKX marketplace identity verification and is not issued or endorsed by OKX.",
  "HTTPS and MCP execution occurred off-chain; the registry is a single-writer attestation registry, not a decentralized oracle.",
];

function createRunId(publicRun: boolean): string {
  return publicRun ? `0x${randomBytes(32).toString("hex")}` : `local-${randomBytes(12).toString("hex")}`;
}

function manifestUrl(input: string): string {
  const url = new URL(input);
  if (url.pathname === "/" || url.pathname === "") url.pathname = "/.well-known/launch-contract.json";
  return url.toString();
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
  if (error instanceof ResponseLimitError) return error.message;
  if (error instanceof Error) return error.message.replace(/0x[0-9a-fA-F]{64}/g, "[redacted]").slice(0, 500);
  return "Unknown rehearsal failure";
}

function isTimeout(error: { message: string } | null, latency: number, max: number): boolean {
  return latency >= max || Boolean(error && /timeout|timed out|abort/i.test(error.message));
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
  ) {
    this.limiter = pLimit(config.MAX_CONCURRENT_RUNS);
    this.registry = new RegistryService(config);
    this.targetPayments = new TargetPaymentService(config, repository);
  }

  async start(request: RehearsalRequest, waitForCompletion: boolean): Promise<StoredRun> {
    const reserved = await this.reserve(request.url, request.idempotency_key);
    if ("canonical_evidence" in reserved || reserved.state !== "payment_required") return reserved;
    return this.runReserved(reserved.run_id, request, waitForCompletion);
  }

  async reserve(url: string, idempotencyKey: string): Promise<StoredRun> {
    const existing = await this.repository.getByIdempotencyKey(idempotencyKey);
    if (existing) return existing;
    const runId = createRunId(this.config.productionReady);
    const timestamp = new Date().toISOString();
    return this.repository.createProgress({
      run_id: runId,
      idempotency_key: idempotencyKey,
      state: "payment_required",
      target: url,
      created_at: timestamp,
      updated_at: timestamp,
      error: null,
    });
  }

  async runReserved(runId: string, request: RehearsalRequest, waitForCompletion: boolean): Promise<StoredRun> {
    if (this.active.has(runId)) return (await this.repository.getRun(runId))!;
    this.active.add(runId);
    await this.repository.updateState(runId, "payment_settled");
    await this.repository.updateState(runId, "queued");
    const task = this.limiter(() => this.execute(runId, request)).finally(() => this.active.delete(runId));
    if (waitForCompletion) {
      await task;
      return (await this.repository.getRun(runId))!;
    }
    void task.catch(() => undefined);
    return (await this.repository.getRun(runId))!;
  }

  private async execute(runId: string, request: RehearsalRequest): Promise<void> {
    const runStarted = performance.now();
    let manifest: LaunchContract | null = null;
    let declarationState: "verified" | "not_provided" | "invalid" = "not_provided";
    try {
      await this.repository.updateState(runId, "fetching_contract");
      const raw = await fetchJson<unknown>(manifestUrl(request.url), this.config);
      manifest = LaunchContractSchema.parse(raw);
      const manifestHash = hashJcs(manifestSigningBody(manifest));
      if (manifest.declaration_signature) {
        const valid = await verifyMessage({
          address: manifest.provider_address as `0x${string}`,
          message: { raw: manifestHash },
          signature: manifest.declaration_signature as `0x${string}`,
        });
        declarationState = valid ? "verified" : "invalid";
      }
      const sourceOrigin = new URL(manifestUrl(request.url)).hostname.toLowerCase();
      if (new URL(manifest.mcp_endpoint).hostname.toLowerCase() !== sourceOrigin) {
        throw new Error("Launch Contract and MCP endpoint must use the same consenting provider hostname");
      }
      if (manifest.payment && new URL(manifest.payment.resource_url).hostname.toLowerCase() !== sourceOrigin) {
        throw new Error("Paid resource must use the same consenting provider hostname");
      }

      if (request.previous_run_id) {
        const previous = await this.repository.getRun(request.previous_run_id);
        if (!previous || !("canonical_evidence" in previous)) throw new Error("Renewal previous_run_id was not found");
        if (previous.manifest_hash === manifestHash && previous.source_version_sha === manifest.source_revision) {
          throw new Error("Renewal requires a changed manifest or source revision");
        }
      }

      const gates: Gates = {
        discoverable: "not_tested",
        contract_correct: "not_tested",
        fresh_challenge: "not_tested",
        safe_to_rehearse: "pass",
        paid_delivery: "not_tested",
      };
      const client = new McpTargetClient(manifest.mcp_endpoint, this.config, manifest.max_latency_ms, runStarted + 30_000);
      const latencies: number[] = [];
      const allInvocations: InvocationEvidence[] = [];

      await this.repository.updateState(runId, "discovering");
      const initialization = await client.initialize();
      const tools = await client.listTools();
      const declaredTool = tools.find((tool) => tool.name === manifest!.tool);
      gates.discoverable = declaredTool && this.schemaMatches(declaredTool, manifest) ? "pass" : "fail";

      await this.repository.updateState(runId, "fixed_sample");
      const fixedStarted = performance.now();
      const fixedResult = await client.callTool(manifest.tool, manifest.sample_input);
      const fixedLatency = Math.round(performance.now() - fixedStarted);
      latencies.push(fixedLatency);
      const fixedComparisons = fixedResult.output ? evaluateAssertions(fixedResult.output, manifest.assertions) : [];
      const fixedClassification = isTimeout(fixedResult.structuredError, fixedLatency, manifest.max_latency_ms)
        ? "timeout"
        : fixedResult.output
          ? overallClassification(fixedComparisons)
          : "schema_drift";
      const fixed: InvocationEvidence = {
        kind: "fixed_sample",
        index: 0,
        input: manifest.sample_input,
        expected: Object.fromEntries(manifest.assertions.map((item) => [item.path.slice(2), item.value])),
        output: fixedResult.output,
        comparisons: fixedComparisons,
        structured_error: fixedResult.structuredError,
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
      const message = invalidResult.structuredError?.message ?? "";
      const safeStructuredFailure = Boolean(
        invalidResult.structuredError &&
          message.length <= 500 &&
          !/stack|trace|secret|private[_ -]?key|api[_ -]?key|bearer\s/i.test(message),
      );
      const invalid: InvocationEvidence = {
        kind: "invalid_input",
        index: 0,
        input: controlledInvalidInput,
        expected: null,
        output: invalidResult.output,
        comparisons: [],
        structured_error: invalidResult.structuredError,
        latency_ms: invalidLatency,
        classification: safeStructuredFailure ? null : "unsafe_error",
      };
      allInvocations.push(invalid);
      gates.contract_correct =
        fixedComparisons.length > 0 && fixedComparisons.every((item) => item.match) && safeStructuredFailure ? "pass" : "fail";

      await this.repository.updateState(runId, "fresh_challenges");
      const generatedAt = new Date().toISOString();
      const challenges = generateChallenges(manifest.challenge_profile.input_field, 3);
      for (const [index, challenge] of challenges.entries()) {
        const started = performance.now();
        const result = await client.callTool(manifest.tool, challenge.input);
        const latency = Math.round(performance.now() - started);
        latencies.push(latency);
        const comparisons = result.output
          ? compareChallenge(challenge.expected, result.output, manifest.challenge_profile.output_fields)
          : [];
        const classification = isTimeout(result.structuredError, latency, manifest.challenge_profile.max_latency_ms_per_run)
          ? "timeout"
          : result.output
            ? overallClassification(comparisons)
            : "schema_drift";
        allInvocations.push({
          kind: "challenge",
          index,
          input: challenge.input,
          expected: challenge.expected,
          output: result.output,
          comparisons,
          structured_error: result.structuredError,
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

      await this.repository.updateState(runId, "target_payment_or_not_tested");
      let targetPayment: PaymentReference | null = null;
      if (manifest.payment_mode === "x402_optional") {
        try {
          if (declarationState !== "verified") throw new Error("Paid target delivery requires a verified provider declaration");
          const paidDelivery = await this.targetPayments.pay(manifest, runId);
          targetPayment = paidDelivery.payment;
          gates.paid_delivery = paidDelivery.deliveryMatches ? "pass" : "fail";
        } catch {
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
        target: manifestUrl(request.url),
        label: this.config.productionReady ? (manifest.fixture ? "fixture" : "production") : "local_only",
        generated_at: generated,
        manifest,
        discovery: {
          protocol_version: initialization.protocolVersion ?? null,
          server_info: initialization.serverInfo ?? null,
          declared_tool: declaredTool
            ? { name: declaredTool.name, description: declaredTool.description ?? null, inputSchema: declaredTool.inputSchema }
            : null,
        },
        fixed_sample: fixed,
        invalid_input: invalid,
        challenges: challengeInvocations,
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
          inputs: [fixed.input, invalid.input, ...challengeInvocations.map((item) => item.input)],
          normalized_comparisons: normalizedComparisons,
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
      const chain = await this.registry.publish(evidence, hashes);
      if (this.config.productionReady && !chain.published) throw new Error("Production run was not published on chain");
      const record: RunRecord = {
        run_id: runId,
        idempotency_key: request.idempotency_key,
        state: chain.published ? "complete" : "complete_local",
        previous_run_id: request.previous_run_id ?? null,
        label: evidence.label,
        scope: "structured-extraction-v1 only",
        passport_status: status,
        gates,
        canonical_evidence: evidence,
        canonical_evidence_jcs: canonical,
        evidence_hash: hashes.evidenceHash,
        manifest_hash: hashes.manifestHash,
        input_hash: hashes.inputHash,
        normalized_result_hash: hashes.normalizedResultHash,
        source_version_sha: manifest.source_revision,
        build_commit_sha: this.config.BUILD_COMMIT_SHA,
        generated_at: generated,
        provider_declaration: evidence.provider_declaration,
        payment: request.payment,
        target_payment: targetPayment,
        chain,
        remediation,
        limitations,
      };
      await this.repository.saveRun(record);
      await this.repository.savePayment(request.payment, runId);
      if (targetPayment) await this.repository.savePayment(targetPayment, runId);
    } catch (error) {
      const message = safeError(error);
      await this.repository.updateState(runId, "failed", message);
      if (manifest) await this.publishNotRehearsable(runId, request, manifest, declarationState, message).catch(() => undefined);
      throw error;
    }
  }

  private schemaMatches(tool: ToolDescription, manifest: LaunchContract): boolean {
    const properties = tool.inputSchema.properties;
    if (!properties || typeof properties !== "object" || Array.isArray(properties)) return false;
    const fields = new Set(Object.keys(properties));
    return (
      Object.keys(manifest.sample_input).every((field) => fields.has(field)) &&
      fields.has(manifest.challenge_profile.input_field)
    );
  }

  private invalidInput(tool: ToolDescription | undefined, sample: Record<string, unknown>): Record<string, unknown> {
    const invalid = structuredClone(sample);
    const required = Array.isArray(tool?.inputSchema.required)
      ? tool.inputSchema.required.filter((field): field is string => typeof field === "string")
      : [];
    const omitted = required.find((field) => Object.hasOwn(invalid, field)) ?? Object.keys(invalid)[0];
    if (omitted) delete invalid[omitted];
    return invalid;
  }

  private async publishNotRehearsable(
    runId: string,
    request: RehearsalRequest,
    manifest: LaunchContract,
    declarationState: "verified" | "not_provided" | "invalid",
    reason: string,
  ) {
    const gates: Gates = {
      discoverable: "not_tested",
      contract_correct: "not_tested",
      fresh_challenge: "not_tested",
      safe_to_rehearse: "pass",
      paid_delivery: "not_tested",
    };
    const manifestHash = hashJcs(manifestSigningBody(manifest));
    const placeholder = emptyInvocation("fixed_sample", null);
    const invalid = emptyInvocation("invalid_input", null);
    const generated = new Date().toISOString();
    const evidence: CanonicalEvidence = {
      schema_version: "1.0",
      run_id: runId,
      target: manifestUrl(request.url),
      label: this.config.productionReady ? (manifest.fixture ? "fixture" : "production") : "local_only",
      generated_at: generated,
      manifest,
      discovery: { infrastructure_error: reason },
      fixed_sample: placeholder,
      invalid_input: invalid,
      challenges: [],
      timings: { invocation_ms: [], total_ms: 0, observed_p95_ms: 0 },
      gates,
      passport_status: "not-rehearsable",
      provider_declaration: {
        provider_address: manifest.provider_address,
        manifest_hash: manifestHash,
        signature: manifest.declaration_signature ?? null,
        verification_state: declarationState,
      },
      payments: { launchproof: request.payment, target: null },
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
    const chain = await this.registry.publish(evidence, hashes);
    if (!chain.published) return;
    await this.repository.saveRun({
      run_id: runId,
      idempotency_key: request.idempotency_key,
      state: "complete",
      previous_run_id: request.previous_run_id ?? null,
      label: evidence.label,
      scope: "structured-extraction-v1 only",
      passport_status: "not-rehearsable",
      gates,
      canonical_evidence: evidence,
      canonical_evidence_jcs: canonical,
      evidence_hash: hashes.evidenceHash,
      manifest_hash: hashes.manifestHash,
      input_hash: hashes.inputHash,
      normalized_result_hash: hashes.normalizedResultHash,
      source_version_sha: manifest.source_revision,
      build_commit_sha: this.config.BUILD_COMMIT_SHA,
      generated_at: generated,
      provider_declaration: evidence.provider_declaration,
      payment: request.payment,
      target_payment: null,
      chain,
      remediation: evidence.remediation,
      limitations,
    });
    await this.repository.savePayment(request.payment, runId);
  }
}
