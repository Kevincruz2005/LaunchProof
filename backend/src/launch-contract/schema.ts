import { z } from "zod";

const primitive = z.union([z.string().max(5_000), z.number().finite(), z.boolean(), z.null()]);
const sampleValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    primitive,
    z.array(sampleValue).max(20),
    z.record(z.string().max(80), sampleValue).refine((value) => Object.keys(value).length <= 20),
  ]),
);

const AssertionSchema = z
  .object({
    path: z.string().regex(/^\$\.[A-Za-z0-9_]+$/).max(100),
    rule: z.enum(["equals", "gte", "lte", "regex"]),
    value: sampleValue,
    flags: z.string().regex(/^[imsu]*$/).max(4).optional(),
  })
  .strict()
  .superRefine((assertion, context) => {
    if (assertion.rule === "regex") {
      if (typeof assertion.value !== "string" || assertion.value.length > 200) {
        context.addIssue({ code: "custom", message: "regex assertions require a pattern of at most 200 characters" });
      } else {
        try {
          // Compilation is bounded by the length cap; execution has a separate input cap.
          new RegExp(assertion.value, assertion.flags);
        } catch {
          context.addIssue({ code: "custom", message: "invalid regular expression" });
        }
      }
    }
  });

export const LaunchContractSchema = z
  .object({
    contract_version: z.literal("1.0"),
    service_name: z.string().min(1).max(120),
    mcp_endpoint: z.string().url().startsWith("https://").max(2_048),
    tool: z.string().min(1).max(80),
    mode: z.literal("sample_only"),
    sample_input: z.record(z.string().max(80), sampleValue).refine((value) => Object.keys(value).length <= 20),
    assertions: z.array(AssertionSchema).min(1).max(20),
    max_latency_ms: z.number().int().min(100).max(8_000),
    delivery_type: z.literal("synchronous_json"),
    payment_mode: z.enum(["none", "x402_optional"]),
    payment: z
      .object({
        network: z.literal("eip155:196"),
        asset: z.literal("0x779ded0c9e1022225f8e0630b35a9b54be713736"),
        amount: z.string().regex(/^[0-9]+$/).refine((value) => BigInt(value) > 0n),
        recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        resource_url: z.string().url().startsWith("https://").max(2_048),
      })
      .strict()
      .optional(),
    safe_use: z.array(z.string().min(1).max(120)).min(1).max(10),
    source_revision: z.string().min(1).max(100),
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
    provider_address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
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
    const safety = manifest.safe_use.join(" ").toLowerCase();
    if (/credential|cookie|upload|write|wallet sign|side effect/.test(safety) && !/no (credential|cookie|upload|write|wallet sign|external side effect)/.test(safety)) {
      context.addIssue({ code: "custom", path: ["safe_use"], message: "unsafe capabilities are not rehearsable" });
    }
  });

export type LaunchContract = z.infer<typeof LaunchContractSchema>;

export function manifestSigningBody(manifest: LaunchContract): Omit<LaunchContract, "declaration_signature"> {
  const { declaration_signature: _signature, ...body } = manifest;
  return body;
}
