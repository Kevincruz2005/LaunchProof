import { z } from "zod";
import type { Config } from "../config.js";

const primitive = z.union([z.string().max(5_000), z.number().finite(), z.boolean(), z.null()]);
const evmAddress = z.string().regex(/^0x(?!0{40}$)[0-9a-fA-F]{40}$/);

const AssertionSchema = z
  .object({
    path: z.string().regex(/^\$\.[A-Za-z0-9_]+$/).max(100),
    rule: z.enum(["equals", "gte", "lte"]),
    value: primitive,
  })
  .strict()
  .superRefine((assertion, context) => {
    if ((assertion.rule === "gte" || assertion.rule === "lte") && typeof assertion.value !== "number") {
      context.addIssue({ code: "custom", path: ["value"], message: "numeric comparisons require a finite number" });
    }
  });

function endpointSchema(allowPrivateTargets: boolean) {
  return z
    .string()
    .url()
    .max(2_048)
    .refine(
      (value) => value.startsWith("https://") || (allowPrivateTargets && value.startsWith("http://")),
      { message: "endpoint must start with https:// (or http:// when private development targets are explicitly enabled)" },
    )
    .refine((value) => {
      const url = new URL(value);
      return !url.username && !url.password && !url.search && !url.hash;
    }, { message: "endpoint credentials, query strings, and fragments are forbidden" });
}

/** The declaration describes tool behavior; an explicitly declared x402 settlement is handled separately. */
export function safeUseClaimsValid(claims: readonly string[]): boolean {
  const joined = claims.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  if (!/\bread[- ]only\b/.test(joined) || !/\b(?:synthetic|sample)\b/.test(joined)) return false;
  if (!/\bno\s+(?:credentials?|account|cookies?)\b/.test(joined)) return false;
  if (!/\bno\s+(?:external\s+)?(?:tool\s+)?side effects?\b|\bno\s+(?:tool\s+)?writes?\b/.test(joined)) {
    return false;
  }

  const withoutNegativeClaims = joined
    .replace(/\bno\s+(?:credentials?|account|cookies?)(?:\s+or\s+(?:credentials?|account|cookies?))*/g, "")
    .replace(/\bno\s+(?:external\s+)?(?:tool\s+)?side effects?(?:\s+beyond\s+the\s+declared\s+x402\s+payment)?/g, "")
    .replace(/\bno\s+(?:tool\s+)?writes?\b/g, "")
    .replace(/\bread[- ]only\b/g, "");
  return !/\b(?:write|writes|modify|modifies|delete|deletes|upload|uploads|credential|credentials|cookie|cookies|account|wallet\s+sign|production\s+record)\b/.test(withoutNegativeClaims);
}

function createLaunchContractSchema(allowPrivateTargets: boolean) {
  return z
  .object({
    contract_version: z.literal("1.0"),
    service_name: z.string().min(1).max(120),
    mcp_endpoint: endpointSchema(allowPrivateTargets),
    tool: z.string().min(1).max(80),
    mode: z.literal("sample_only"),
    sample_input: z.record(z.string().max(80), primitive).refine((value) => Object.keys(value).length <= 20),
    assertions: z.array(AssertionSchema).min(1).max(20),
    max_latency_ms: z.number().int().min(100).max(8_000),
    delivery_type: z.literal("synchronous_json"),
    payment_mode: z.enum(["none", "x402_optional"]),
    payment: z
      .object({
        network: z.string().regex(/^eip155:[1-9][0-9]*$/),
        asset: evmAddress,
        amount: z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) > 0n),
        recipient: evmAddress,
        resource_url: endpointSchema(allowPrivateTargets),
      })
      .strict()
      .optional(),
    safe_use: z.array(z.string().min(1).max(120)).min(1).max(10),
    source_revision: z.string().regex(/^[0-9a-fA-F]{40}$/, "source_revision must be an immutable 40-character Git commit SHA"),
    challenge_profile: z
      .object({
        name: z.literal("structured-extraction-v1"),
        tool: z.string().min(1).max(80),
        input_field: z.string().min(1).max(80),
        output_fields: z.array(z.string().min(1).max(80)).min(1).max(10),
        challenge_runs: z.literal(3),
        max_latency_ms_per_run: z.number().int().min(100).max(8_000),
        safe_mode: z.literal("synthetic_read_only"),
      })
      .strict(),
    provider_address: evmAddress,
    declaration_signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/).optional(),
    fixture: z.boolean().optional(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (manifest.tool !== manifest.challenge_profile.tool) {
      context.addIssue({ code: "custom", path: ["challenge_profile", "tool"], message: "challenge tool must match declared tool" });
    }
    if (manifest.payment_mode === "x402_optional" && !manifest.payment) {
      context.addIssue({ code: "custom", path: ["payment"], message: "x402 terms are required" });
    }
    if (manifest.payment_mode === "none" && manifest.payment) {
      context.addIssue({ code: "custom", path: ["payment"], message: "payment terms are forbidden when payment_mode is none" });
    }
    const supportedOutputFields = ["document_id", "currency", "total", "due_date"];
    const outputFields = [...new Set(manifest.challenge_profile.output_fields)].sort();
    if (
      outputFields.length !== manifest.challenge_profile.output_fields.length ||
      outputFields.length !== supportedOutputFields.length ||
      outputFields.some((field, index) => field !== [...supportedOutputFields].sort()[index])
    ) {
      context.addIssue({
        code: "custom",
        path: ["challenge_profile", "output_fields"],
        message: "structured-extraction-v1 output_fields must be document_id, currency, total, and due_date",
      });
    }
    if (!safeUseClaimsValid(manifest.safe_use)) {
      context.addIssue({
        code: "custom",
        path: ["safe_use"],
        message: "safe_use must truthfully declare read-only synthetic/sample tool behavior, no credentials/account, and no tool side effects",
      });
    }
    const sensitiveKey = /^(?:authorization|cookie|pass(?:word|phrase)?|secret|private[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|token)$/i;
    const sampleSensitiveKey = Object.keys(manifest.sample_input).find((key) => sensitiveKey.test(key));
    if (sampleSensitiveKey) {
      context.addIssue({ code: "custom", path: ["sample_input", sampleSensitiveKey], message: "credential-like sample fields cannot be published" });
    }
    const publicTexts = [
      manifest.service_name,
      manifest.tool,
      ...Object.values(manifest.sample_input).filter((value): value is string => typeof value === "string"),
      ...manifest.assertions.flatMap((assertion) => [assertion.path, typeof assertion.value === "string" ? assertion.value : ""]),
      ...manifest.safe_use,
      manifest.challenge_profile.tool,
      manifest.challenge_profile.input_field,
      ...manifest.challenge_profile.output_fields,
    ];
    if (publicTexts.some(containsCredentialLikeText)) {
      context.addIssue({ code: "custom", message: "Launch Contract contains credential-like text that cannot be published" });
    }
  });
}

function containsCredentialLikeText(value: string): boolean {
  return /\bBearer\s+[^\s,;]+/i.test(value) ||
    /\b(?:api[_-]?key|secret|password|passphrase|access[_-]?token|refresh[_-]?token|private[_-]?key|authorization)\s*[:=]\s*\S+/i.test(value) ||
    /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value) ||
    /0x[0-9a-fA-F]{64}/.test(value);
}

/** Public schema is fail-closed and accepts HTTPS endpoints only. */
export const LaunchContractSchema = createLaunchContractSchema(false);

export type LaunchContract = z.infer<typeof LaunchContractSchema>;

/** Parse a manifest against the active, typed chain policy. */
export function parseLaunchContract(input: unknown, config: Pick<Config, "ALLOW_PRIVATE_TARGETS" | "chain">): LaunchContract {
  const manifest = createLaunchContractSchema(config.ALLOW_PRIVATE_TARGETS).parse(input);
  if (manifest.payment) {
    if (manifest.payment.network !== config.chain.network) {
      throw new Error(`Launch Contract payment network must be ${config.chain.network}`);
    }
    if (manifest.payment.asset.toLowerCase() !== config.chain.usdt0Address.toLowerCase()) {
      throw new Error(`Launch Contract payment asset must be ${config.chain.usdt0Address}`);
    }
  }
  return manifest;
}

export function manifestSigningBody(manifest: LaunchContract): Omit<LaunchContract, "declaration_signature"> {
  const { declaration_signature: _signature, ...body } = manifest;
  return body;
}
