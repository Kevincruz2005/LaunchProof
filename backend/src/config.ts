import { z } from "zod";

const bool = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
const optionalUrl = z.string().url().optional().or(z.literal("").transform(() => undefined));
const optionalAddress = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalKey = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  PUBLIC_WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  BUILD_COMMIT_SHA: z.string().min(1).default("development"),
  SOURCE_REPOSITORY: z.string().url().default("https://github.com/your-org/launchproof"),
  OKX_AI_LISTING_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  DEMO_VIDEO_URL: optionalUrl,
  REFERENCE_PAYMENT_ID: z.string().min(1).max(200).optional().or(z.literal("").transform(() => undefined)),
  XLAYER_RPC_URL: optionalUrl,
  XLAYER_FALLBACK_RPC_URL: optionalUrl,
  REGISTRY_ADDRESS: optionalAddress,
  REGISTRY_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  REGISTRY_WRITER_PRIVATE_KEY: optionalKey,
  TARGET_PAYER_PRIVATE_KEY: optionalKey,
  PAYOUT_ADDRESS: optionalAddress,
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET_KEY: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  OKX_BASE_URL: optionalUrl,
  X402_ENABLED: bool,
  DATABASE_URL: z.string().optional(),
  TARGET_PAYMENT_MAX_USDT0: z.coerce.number().positive().max(10).default(0.1),
  TARGET_PAYMENT_DAILY_LIMIT_USDT0: z.coerce.number().positive().max(100).default(1),
  TARGET_ALLOWLIST: z.string().default(""),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(10).default(3),
  FREE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  PAID_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(6),
  GLOBAL_RUN_LIMIT_PER_DAY: z.coerce.number().int().positive().default(100),
  FIXTURE_BASE_DOMAIN: z.string().min(3).optional().or(z.literal("").transform(() => undefined)),
  FIXTURE_HEALTHY_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_TIMEOUT_PROVIDER_ADDRESS: optionalAddress,
  ALLOW_LOCAL_UNPAID_RUNS: bool,
  ALLOW_PRIVATE_TARGETS: bool,
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(source);
  const productionReady = Boolean(
    parsed.X402_ENABLED &&
      parsed.XLAYER_RPC_URL &&
      parsed.XLAYER_FALLBACK_RPC_URL &&
      parsed.REGISTRY_ADDRESS &&
      parsed.REGISTRY_DEPLOYMENT_BLOCK > 0n &&
      parsed.REGISTRY_WRITER_PRIVATE_KEY &&
      parsed.TARGET_PAYER_PRIVATE_KEY &&
      parsed.PAYOUT_ADDRESS &&
      parsed.DATABASE_URL &&
      parsed.OKX_API_KEY &&
      parsed.OKX_SECRET_KEY &&
      parsed.OKX_PASSPHRASE &&
      parsed.FIXTURE_BASE_DOMAIN &&
      parsed.FIXTURE_HEALTHY_PROVIDER_ADDRESS &&
      parsed.FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS &&
      parsed.FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS &&
      parsed.FIXTURE_TIMEOUT_PROVIDER_ADDRESS,
  );
  if (parsed.NODE_ENV === "production" && !productionReady) {
    throw new Error(
      "Production startup refused: x402 facilitator, payout wallet, registry writer, RPC, registry, database, and fixture domain are required",
    );
  }
  if (parsed.NODE_ENV === "production" && parsed.ALLOW_LOCAL_UNPAID_RUNS) {
    throw new Error("ALLOW_LOCAL_UNPAID_RUNS is forbidden in production");
  }
  if (parsed.NODE_ENV === "production") {
    if (!/^[0-9a-f]{40}$/i.test(parsed.BUILD_COMMIT_SHA)) throw new Error("BUILD_COMMIT_SHA must be an immutable 40-character commit in production");
    if (parsed.SOURCE_REPOSITORY.includes("your-org")) throw new Error("SOURCE_REPOSITORY must be the real public repository in production");
    if (!parsed.PUBLIC_API_BASE_URL.startsWith("https://") || !parsed.PUBLIC_WEB_BASE_URL.startsWith("https://")) {
      throw new Error("Production public URLs must use HTTPS");
    }
    if (parsed.PAYOUT_ADDRESS === "0x0000000000000000000000000000000000000000" || parsed.REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000") {
      throw new Error("Production payout and registry addresses must be nonzero");
    }
  }
  return {
    ...parsed,
    productionReady,
    targetAllowlist: new Set(
      parsed.TARGET_ALLOWLIST.split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    ),
  };
}

export const NETWORK = "eip155:196" as const;
export const CHAIN_ID = 196;
export const USDT0_ADDRESS = "0x779ded0c9e1022225f8e0630b35a9b54be713736" as const;
export const GENESIS_PRICE = "$0.01";
export const RENEWAL_PRICE = "$0.10";
export const MAX_EVIDENCE_BYTES = 65_536;
