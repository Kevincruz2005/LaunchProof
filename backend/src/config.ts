import { z } from "zod";
import { isPublicAddress } from "./security/network.js";

const bool = z.enum(["true", "false"]).default("false").transform((value) => value === "true");
const testnetBool = z.enum(["true", "false"]).default("true").transform((value) => value === "true");
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
const optionalBytes32 = z
  .string()
  .regex(/^0x[0-9a-fA-F]{64}$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalImageDigest = z
  .string()
  .regex(/^sha256:[0-9a-f]{64}$/i)
  .optional()
  .or(z.literal("").transform(() => undefined));
const optionalPositiveInteger = z.preprocess(
  (value) => (value === "" || value === undefined ? undefined : value),
  z.coerce.number().int().positive().optional(),
);
const nonnegativeNumber = z.coerce.number().finite().nonnegative();
const positiveNumber = z.coerce.number().finite().positive();
const optionalNetwork = z
  .string()
  .regex(/^eip155:[1-9][0-9]*$/)
  .optional()
  .or(z.literal("").transform(() => undefined));
const okxBaseUrl = z.string().url().default("https://web3.okx.com").superRefine((value, context) => {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname.toLowerCase() !== "web3.okx.com" ||
    url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash || url.username || url.password) {
    context.addIssue({ code: "custom", message: "OKX_BASE_URL must be exactly the official https://web3.okx.com origin" });
  }
});

const XLAYER_TESTNET_CHAIN_ID = 1952;
const XLAYER_TESTNET_USDT0_ADDRESS = "0x9e29b3aada05bf2d2c827af80bd28dc0b9b4fb0c" as const;

export type XLayerNetwork = `eip155:${number}`;

export interface XLayerProfile {
  readonly id: number;
  readonly network: XLayerNetwork;
  readonly name: "X Layer" | "X Layer Testnet";
  readonly testnet: boolean;
  readonly rpcUrl?: string;
  readonly fallbackRpcUrl?: string;
  readonly explorerUrl: string;
  readonly usdt0Address: `0x${string}`;
  readonly usdt0Decimals: 6;
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  PUBLIC_API_BASE_URL: z.string().url().default("http://localhost:4000"),
  PUBLIC_WEB_BASE_URL: z.string().url().default("http://localhost:3000"),
  BUILD_COMMIT_SHA: z.string().min(1).default("development"),
  RELEASE_IMAGE_TAG: z.string().optional().or(z.literal("").transform(() => undefined)),
  RELEASE_IMAGE_DIGEST: optionalImageDigest,
  SOURCE_REPOSITORY: z.string().url().default("https://github.com/Kevincruz2005/LaunchProof"),
  OKX_AI_LISTING_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  DEMO_VIDEO_URL: optionalUrl,
  REFERENCE_PAYMENT_ID: z.string().min(1).max(200).optional().or(z.literal("").transform(() => undefined)),
  XLAYER_TESTNET: testnetBool,
  XLAYER_CHAIN_ID: optionalPositiveInteger,
  XLAYER_NETWORK: optionalNetwork,
  XLAYER_USDT0_ADDRESS: optionalAddress,
  XLAYER_EXPLORER_URL: optionalUrl,
  XLAYER_RPC_URL: optionalUrl,
  XLAYER_FALLBACK_RPC_URL: optionalUrl,
  REGISTRY_ADDRESS: optionalAddress,
  REGISTRY_DEPLOYMENT_BLOCK: z.coerce.bigint().nonnegative().default(0n),
  REGISTRY_RUNTIME_CODE_HASH: optionalBytes32,
  REGISTRY_WRITER_PRIVATE_KEY: optionalKey,
  TARGET_PAYER_PRIVATE_KEY: optionalKey,
  PAYOUT_ADDRESS: optionalAddress,
  OKX_API_KEY: z.string().optional(),
  OKX_SECRET_KEY: z.string().optional(),
  OKX_PASSPHRASE: z.string().optional(),
  OKX_BASE_URL: okxBaseUrl,
  X402_ENABLED: bool,
  DATABASE_URL: z.string().optional(),
  LEADERSHIP_DATABASE_URL: z.string().optional(),
  LEADERSHIP_DATABASE_MODE: z.enum(["session"]).optional(),
  TARGET_PAYMENT_MAX_USDT0: z.coerce.number().positive().max(10).default(0.1),
  TARGET_PAYMENT_DAILY_LIMIT_USDT0: z.coerce.number().positive().max(100).default(1),
  TARGET_ALLOWLIST: z.string().default(""),
  MAX_CONCURRENT_RUNS: z.coerce.number().int().min(1).max(10).default(3),
  FREE_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  PAID_RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(6),
  GLOBAL_RUN_LIMIT_PER_DAY: z.coerce.number().int().positive().default(100),
  BACKEND_REPLICA_COUNT: z.coerce.number().int().positive().default(1),
  FIXTURE_HEALTHY_URL: optionalUrl,
  FIXTURE_INVALID_OUTPUT_URL: optionalUrl,
  FIXTURE_SCHEMA_DRIFT_URL: optionalUrl,
  FIXTURE_TIMEOUT_URL: optionalUrl,
  FIXTURE_HEALTHY_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS: optionalAddress,
  FIXTURE_TIMEOUT_PROVIDER_ADDRESS: optionalAddress,
  ALLOW_LOCAL_UNPAID_RUNS: bool,
  ALLOW_PRIVATE_TARGETS: bool,
  PUBLIC_ALLOWED_ORIGINS: z.string().default(""),
  PASSPORT_GATE_WARN_AGE_HOURS: nonnegativeNumber.default(24),
  PASSPORT_GATE_MAX_AGE_HOURS: positiveNumber.default(168),
});

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(source: NodeJS.ProcessEnv = process.env) {
  const parsed = EnvSchema.parse(source);
  if (parsed.PASSPORT_GATE_MAX_AGE_HOURS <= parsed.PASSPORT_GATE_WARN_AGE_HOURS) {
    throw new Error("PASSPORT_GATE_MAX_AGE_HOURS must be greater than PASSPORT_GATE_WARN_AGE_HOURS");
  }
  if (!parsed.XLAYER_TESTNET) {
    throw new Error("X Layer mainnet is unsupported; LaunchProof must run on X Layer Testnet");
  }
  const expectedChainId = XLAYER_TESTNET_CHAIN_ID;
  const chainId = parsed.XLAYER_CHAIN_ID ?? expectedChainId;
  if (chainId !== expectedChainId) {
    throw new Error(`XLAYER_CHAIN_ID must be ${expectedChainId} when XLAYER_TESTNET=${parsed.XLAYER_TESTNET}`);
  }
  const expectedNetwork = `eip155:${chainId}` as const;
  if (parsed.XLAYER_NETWORK && parsed.XLAYER_NETWORK !== expectedNetwork) {
    throw new Error(`XLAYER_NETWORK must be ${expectedNetwork} for chain ${chainId}`);
  }
  if (parsed.XLAYER_USDT0_ADDRESS && parsed.XLAYER_USDT0_ADDRESS.toLowerCase() !== XLAYER_TESTNET_USDT0_ADDRESS) {
    throw new Error(`XLAYER_USDT0_ADDRESS must be the official X Layer Testnet USD₮0 contract ${XLAYER_TESTNET_USDT0_ADDRESS}`);
  }
  const chain: XLayerProfile = Object.freeze({
    id: chainId,
    network: expectedNetwork,
    name: "X Layer Testnet",
    testnet: true,
    rpcUrl: parsed.XLAYER_RPC_URL,
    fallbackRpcUrl: parsed.XLAYER_FALLBACK_RPC_URL,
    explorerUrl:
      parsed.XLAYER_EXPLORER_URL ??
      "https://www.okx.com/web3/explorer/xlayer-test",
    usdt0Address: (parsed.XLAYER_USDT0_ADDRESS ??
      XLAYER_TESTNET_USDT0_ADDRESS) as `0x${string}`,
    usdt0Decimals: 6,
  });
  const fixtureUrls = {
    healthy: parsed.FIXTURE_HEALTHY_URL,
    "invalid-output": parsed.FIXTURE_INVALID_OUTPUT_URL,
    "schema-drift": parsed.FIXTURE_SCHEMA_DRIFT_URL,
    timeout: parsed.FIXTURE_TIMEOUT_URL,
  } as const;
  const fixtureAddresses = {
    healthy: parsed.FIXTURE_HEALTHY_PROVIDER_ADDRESS,
    "invalid-output": parsed.FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS,
    "schema-drift": parsed.FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS,
    timeout: parsed.FIXTURE_TIMEOUT_PROVIDER_ADDRESS,
  } as const;
  const targetAllowlist = new Set(
    parsed.TARGET_ALLOWLIST.split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  const configuredAddresses = [
    parsed.REGISTRY_ADDRESS,
    parsed.PAYOUT_ADDRESS,
    ...Object.values(fixtureAddresses),
  ].filter((address): address is string => Boolean(address));
  if (configuredAddresses.some((address) => /^0x0{40}$/i.test(address))) {
    throw new Error("Configured registry, payout, and provider roles must use nonzero addresses");
  }
  if ([parsed.REGISTRY_WRITER_PRIVATE_KEY, parsed.TARGET_PAYER_PRIVATE_KEY].some((key) => key && /^0x0{64}$/i.test(key))) {
    throw new Error("Configured registry writer and target payer keys must be nonzero");
  }
  const chainRequested = Boolean(
    parsed.XLAYER_RPC_URL ||
      parsed.REGISTRY_ADDRESS ||
      parsed.REGISTRY_DEPLOYMENT_BLOCK > 0n ||
      parsed.REGISTRY_WRITER_PRIVATE_KEY ||
      parsed.REGISTRY_RUNTIME_CODE_HASH,
  );
  if (
    chainRequested &&
    (!parsed.XLAYER_RPC_URL ||
      !parsed.REGISTRY_ADDRESS ||
      parsed.REGISTRY_DEPLOYMENT_BLOCK === 0n ||
      !parsed.REGISTRY_WRITER_PRIVATE_KEY ||
      !parsed.REGISTRY_RUNTIME_CODE_HASH)
  ) {
    throw new Error(
      "Chain publication requires XLAYER_RPC_URL, REGISTRY_ADDRESS, REGISTRY_DEPLOYMENT_BLOCK, REGISTRY_WRITER_PRIVATE_KEY, and REGISTRY_RUNTIME_CODE_HASH",
    );
  }
  // chainReady means startup preflight can prove the exact deployment before any publication.
  const chainReady = Boolean(
    parsed.XLAYER_RPC_URL &&
      parsed.REGISTRY_ADDRESS &&
      parsed.REGISTRY_DEPLOYMENT_BLOCK > 0n &&
      parsed.REGISTRY_WRITER_PRIVATE_KEY &&
      parsed.REGISTRY_RUNTIME_CODE_HASH,
  );
  const productionReady = Boolean(
    parsed.X402_ENABLED &&
      parsed.XLAYER_RPC_URL &&
      parsed.XLAYER_FALLBACK_RPC_URL &&
      parsed.REGISTRY_ADDRESS &&
      parsed.REGISTRY_DEPLOYMENT_BLOCK > 0n &&
      parsed.REGISTRY_WRITER_PRIVATE_KEY &&
      parsed.REGISTRY_RUNTIME_CODE_HASH &&
      parsed.TARGET_PAYER_PRIVATE_KEY &&
      parsed.PAYOUT_ADDRESS &&
      parsed.DATABASE_URL &&
      parsed.LEADERSHIP_DATABASE_URL &&
      parsed.LEADERSHIP_DATABASE_MODE === "session" &&
      parsed.OKX_API_KEY &&
      parsed.OKX_SECRET_KEY &&
      parsed.OKX_PASSPHRASE &&
      parsed.RELEASE_IMAGE_TAG &&
      parsed.RELEASE_IMAGE_DIGEST &&
      Object.values(fixtureUrls).every(Boolean) &&
      parsed.FIXTURE_HEALTHY_PROVIDER_ADDRESS &&
      parsed.FIXTURE_INVALID_OUTPUT_PROVIDER_ADDRESS &&
      parsed.FIXTURE_SCHEMA_DRIFT_PROVIDER_ADDRESS &&
      parsed.FIXTURE_TIMEOUT_PROVIDER_ADDRESS,
  );
  if (parsed.NODE_ENV === "production" && !productionReady) {
    throw new Error(
      "Production startup refused: x402 facilitator, payout wallet, registry writer, RPC, registry, database, immutable image identity, and four explicit fixture URLs/identities are required",
    );
  }
  if (productionReady) {
    const providers = Object.values(fixtureAddresses).map((address) => address!.toLowerCase());
    if (new Set(providers).size !== providers.length) {
      throw new Error("Each controlled fixture must use a distinct provider declaration address");
    }
    const missingTargetHost = Object.values(fixtureUrls).find((fixtureUrl) =>
      fixtureUrl && !targetAllowlist.has(new URL(fixtureUrl).hostname.toLowerCase())
    );
    if (missingTargetHost) throw new Error("TARGET_ALLOWLIST must include every controlled fixture hostname");
  }
  if (parsed.NODE_ENV === "production" && parsed.ALLOW_LOCAL_UNPAID_RUNS) {
    throw new Error("ALLOW_LOCAL_UNPAID_RUNS is forbidden in production");
  }
  if (parsed.NODE_ENV === "production" && parsed.ALLOW_PRIVATE_TARGETS) {
    throw new Error("ALLOW_PRIVATE_TARGETS is forbidden in production");
  }
  const apiIsLoopback = isLoopbackUrl(parsed.PUBLIC_API_BASE_URL);
  const webIsLoopback = isLoopbackUrl(parsed.PUBLIC_WEB_BASE_URL);
  if (parsed.NODE_ENV === "development" && (!apiIsLoopback || !webIsLoopback || chainReady || parsed.X402_ENABLED)) {
    throw new Error("Public, chain-ready, and x402 services must run with NODE_ENV=production");
  }
  if (parsed.ALLOW_LOCAL_UNPAID_RUNS && (!apiIsLoopback || parsed.X402_ENABLED)) {
    throw new Error("ALLOW_LOCAL_UNPAID_RUNS requires a loopback API URL and X402_ENABLED=false");
  }
  if (parsed.ALLOW_PRIVATE_TARGETS && (!apiIsLoopback || !parsed.ALLOW_LOCAL_UNPAID_RUNS)) {
    throw new Error("ALLOW_PRIVATE_TARGETS is allowed only for an explicitly unpaid loopback development service");
  }
  if (parsed.BACKEND_REPLICA_COUNT !== 1) {
    throw new Error("LaunchProof currently requires exactly one backend replica for writer and recovery safety");
  }
  if (chainReady && !/^[0-9a-f]{40}$/i.test(parsed.BUILD_COMMIT_SHA)) {
    throw new Error("BUILD_COMMIT_SHA must be the immutable 40-character commit used for this chain-published build");
  }
  if (parsed.NODE_ENV === "production") {
    requireExplicitProductionConfig(source, [
      "PUBLIC_API_BASE_URL",
      "PUBLIC_WEB_BASE_URL",
      "BUILD_COMMIT_SHA",
      "RELEASE_IMAGE_TAG",
      "RELEASE_IMAGE_DIGEST",
      "SOURCE_REPOSITORY",
      "XLAYER_TESTNET",
      "XLAYER_CHAIN_ID",
      "XLAYER_NETWORK",
      "XLAYER_USDT0_ADDRESS",
      "XLAYER_EXPLORER_URL",
      "XLAYER_RPC_URL",
      "XLAYER_FALLBACK_RPC_URL",
      "OKX_BASE_URL",
      "X402_ENABLED",
    ]);
    if (!/^[0-9a-f]{40}$/i.test(parsed.BUILD_COMMIT_SHA)) throw new Error("BUILD_COMMIT_SHA must be an immutable 40-character commit in production");
    if (parsed.RELEASE_IMAGE_TAG?.toLowerCase() !== parsed.BUILD_COMMIT_SHA.toLowerCase()) {
      throw new Error("RELEASE_IMAGE_TAG must equal the full BUILD_COMMIT_SHA in production");
    }
    if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/i.test(parsed.SOURCE_REPOSITORY)) {
      throw new Error("SOURCE_REPOSITORY must be a real public GitHub repository in production");
    }
    assertProductionUrl("PUBLIC_API_BASE_URL", parsed.PUBLIC_API_BASE_URL, true);
    assertProductionUrl("PUBLIC_WEB_BASE_URL", parsed.PUBLIC_WEB_BASE_URL, true);
    for (const origin of parsed.PUBLIC_ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean)) {
      assertProductionUrl("PUBLIC_ALLOWED_ORIGINS", origin, true);
    }
    assertProductionUrl("XLAYER_RPC_URL", parsed.XLAYER_RPC_URL!, false);
    assertProductionUrl("XLAYER_FALLBACK_RPC_URL", parsed.XLAYER_FALLBACK_RPC_URL!, false);
    assertProductionUrl("XLAYER_EXPLORER_URL", parsed.XLAYER_EXPLORER_URL!, false);
    for (const [variant, fixtureUrl] of Object.entries(fixtureUrls)) {
      assertProductionUrl(`FIXTURE_${variant.toUpperCase().replaceAll("-", "_")}_URL`, fixtureUrl!, true);
    }
    assertProductionDatabaseUrl(parsed.DATABASE_URL!);
    assertProductionDatabaseUrl(parsed.LEADERSHIP_DATABASE_URL!);
    assertProductionCredential("OKX_API_KEY", parsed.OKX_API_KEY!, 12);
    assertProductionCredential("OKX_SECRET_KEY", parsed.OKX_SECRET_KEY!, 24);
    assertProductionCredential("OKX_PASSPHRASE", parsed.OKX_PASSPHRASE!, 8);
    if (isWeakPrivateKey(parsed.REGISTRY_WRITER_PRIVATE_KEY!) || isWeakPrivateKey(parsed.TARGET_PAYER_PRIVATE_KEY!)) {
      throw new Error("Production private keys must not use zero, repeated-byte, or generated development identities");
    }
    if (parsed.REGISTRY_WRITER_PRIVATE_KEY!.toLowerCase() === parsed.TARGET_PAYER_PRIVATE_KEY!.toLowerCase()) {
      throw new Error("Registry writer and target payer must use separate production identities");
    }
    const publicRoleAddresses = [parsed.REGISTRY_ADDRESS!, parsed.PAYOUT_ADDRESS!, ...Object.values(fixtureAddresses) as string[]]
      .map((address) => address.toLowerCase());
    if (new Set(publicRoleAddresses).size !== publicRoleAddresses.length) {
      throw new Error("Registry, payout, and controlled fixture declaration addresses must be distinct in production");
    }
    for (const host of targetAllowlist) {
      if (host.includes("://") || host.includes("/") || host.includes(":") || isUnsafeProductionHostname(host)) {
        throw new Error("TARGET_ALLOWLIST must contain only public, non-placeholder hostnames in production");
      }
    }
    if (parsed.PAYOUT_ADDRESS === "0x0000000000000000000000000000000000000000" || parsed.REGISTRY_ADDRESS === "0x0000000000000000000000000000000000000000") {
      throw new Error("Production payout and registry addresses must be nonzero");
    }
  }
  return {
    ...parsed,
    chain,
    fixtureUrls,
    fixtureAddresses,
    productionReady,
    chainReady,
    paymentReady: parsed.NODE_ENV === "production" && productionReady && chain.testnet,
    publicAllowedOrigins: new Set(
      [parsed.PUBLIC_WEB_BASE_URL, ...parsed.PUBLIC_ALLOWED_ORIGINS.split(",")]
        .map((value) => normalizeOrigin(value))
        .filter((value): value is string => Boolean(value)),
    ),
    targetAllowlist,
  };
}

export const GENESIS_PRICE = "$0.01";
export const RENEWAL_PRICE = "$0.10";
export const GENESIS_AMOUNT = "0.01";
export const RENEWAL_AMOUNT = "0.10";
export const GENESIS_AMOUNT_ATOMIC = "10000";
export const RENEWAL_AMOUNT_ATOMIC = "100000";
export const MAX_EVIDENCE_BYTES = 65_536;

function normalizeOrigin(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.search || url.hash || (url.pathname !== "/" && url.pathname !== "")) {
      throw new Error("origin contains credentials, path, query, or fragment");
    }
    return url.origin;
  } catch {
    throw new Error(`Invalid origin in PUBLIC_ALLOWED_ORIGINS: ${trimmed}`);
  }
}

function isLoopbackUrl(rawUrl: string): boolean {
  const hostname = new URL(rawUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost" || hostname === "::1" || /^127(?:\.[0-9]{1,3}){3}$/.test(hostname);
}

function requireExplicitProductionConfig(source: NodeJS.ProcessEnv, names: readonly string[]): void {
  const missing = names.filter((name) => !source[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Production startup refused: explicit configuration is required for ${missing.join(", ")}`);
  }
}

function assertProductionUrl(name: string, raw: string, originOnly: boolean): void {
  const url = new URL(raw);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (originOnly && url.pathname !== "/" && url.pathname !== "") ||
    isUnsafeProductionHostname(url.hostname)
  ) {
    throw new Error(`${name} must be a public, non-placeholder HTTPS ${originOnly ? "origin" : "URL"} in production`);
  }
}

function assertProductionDatabaseUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL in production");
  }
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol) || !url.username || !url.password || !url.pathname.slice(1) || isUnsafeProductionHostname(url.hostname)) {
    throw new Error("DATABASE_URL must be a credentialed, public, non-placeholder PostgreSQL URL in production");
  }
  assertProductionCredential("DATABASE_URL password", url.password, 12);
}

function assertProductionCredential(name: string, value: string, minimumLength: number): void {
  const normalized = value.trim().toLowerCase();
  if (
    value.trim().length < minimumLength ||
    /^(?:test|dev|demo|example|sample|placeholder|changeme|password|secret|key|passphrase|launchproof)[-_0-9]*$/i.test(normalized) ||
    /(?:placeholder|change[-_ ]?me|replace[-_ ]?me|your[-_ ])/i.test(normalized)
  ) {
    throw new Error(`${name} is missing or contains a development/placeholder credential`);
  }
}

function isUnsafeProductionHostname(rawHostname: string): boolean {
  const hostname = rawHostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".example") ||
    hostname.endsWith(".invalid") ||
    hostname.endsWith(".test") ||
    hostname.includes("placeholder")
  ) return true;
  return /^[0-9a-f:.]+$/i.test(hostname) && !isPublicAddress(hostname);
}

function isWeakPrivateKey(value: string): boolean {
  const body = value.slice(2).toLowerCase();
  return /^0+$/.test(body) || /^(..)(?:\1){31}$/.test(body);
}
