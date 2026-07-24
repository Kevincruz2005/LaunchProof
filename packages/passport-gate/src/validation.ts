import { PassportGateValidationError } from "./errors.js";
import {
  normalizeAddress,
  normalizePublicHttpsUrl,
  normalizeSourceRevision,
} from "./primitives.js";
import {
  XLAYER_TESTNET_CHAIN_ID,
  XLAYER_TESTNET_NETWORK,
  type PassportGateConfig,
  type PassportGateRequest,
  type ValidatedPassportGateRequest,
} from "./types.js";

function validateThresholds(warn: number, max: number): void {
  if (!Number.isFinite(warn) || !Number.isFinite(max) || warn < 0 || max <= warn) {
    throw new PassportGateValidationError(
      "INVALID_FRESHNESS_THRESHOLDS",
      "warn_age_hours must be at least zero and max_age_hours must be greater than warn_age_hours.",
    );
  }
}

function normalizeBaseUrl(value: string, field: string, deploymentMode: "public" | "local"): string {
  let normalized: string;
  if (deploymentMode === "local") {
    try {
      normalized = normalizePublicHttpsUrl(value, field);
      return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
    } catch {
      // Isolated development may use only explicit loopback HTTP below.
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      throw new PassportGateValidationError("INVALID_CONFIGURATION", `${field} must be an absolute URL.`);
    }
    const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    const loopback = hostname === "localhost" || hostname === "::1" || /^127(?:\.\d{1,3}){3}$/.test(hostname);
    if (!loopback || parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash) {
      throw new PassportGateValidationError(
        "INVALID_CONFIGURATION",
        `${field} may use HTTP only on a loopback host in local deployment mode.`,
      );
    }
    normalized = parsed.toString();
  } else {
    normalized = normalizePublicHttpsUrl(value, field);
  }
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

export function validatePassportGateConfig(config: PassportGateConfig): PassportGateConfig {
  const deploymentMode = config.deploymentMode ?? "public";
  if (config.chainId !== XLAYER_TESTNET_CHAIN_ID || config.network !== XLAYER_TESTNET_NETWORK) {
    throw new PassportGateValidationError(
      "INVALID_CONFIGURATION",
      "PassportGate is restricted to X Layer testnet (eip155:1952).",
    );
  }
  if (!Number.isInteger(config.assetDecimals) || config.assetDecimals < 0 || config.assetDecimals > 255) {
    throw new PassportGateValidationError("INVALID_CONFIGURATION", "Configured asset decimals are invalid.");
  }
  validateThresholds(config.defaultWarnAgeHours, config.defaultMaxAgeHours);
  let assetAddress;
  try {
    assetAddress = normalizeAddress(config.assetAddress);
  } catch {
    throw new PassportGateValidationError("INVALID_CONFIGURATION", "Configured testnet asset address is invalid.");
  }
  return {
    ...config,
    deploymentMode,
    assetAddress,
    explorerBaseUrl: normalizeBaseUrl(config.explorerBaseUrl, "explorerBaseUrl", deploymentMode),
    passportBaseUrl: normalizeBaseUrl(config.passportBaseUrl, "passportBaseUrl", deploymentMode),
    rehearsalBaseUrl: normalizeBaseUrl(config.rehearsalBaseUrl, "rehearsalBaseUrl", deploymentMode),
  };
}

export function validatePassportGateRequest(
  request: PassportGateRequest,
  config: PassportGateConfig,
): ValidatedPassportGateRequest {
  const warnAgeHours = request.warn_age_hours ?? config.defaultWarnAgeHours;
  const maxAgeHours = request.max_age_hours ?? config.defaultMaxAgeHours;
  validateThresholds(warnAgeHours, maxAgeHours);

  let expectedProviderAddress = null;
  if (request.expected_provider_address !== undefined) {
    expectedProviderAddress = normalizeAddress(request.expected_provider_address);
  }
  const expectedSourceRevision =
    request.expected_source_revision === undefined
      ? null
      : normalizeSourceRevision(request.expected_source_revision);

  return {
    launchContractUrl: normalizePublicHttpsUrl(request.launch_contract_url),
    warnAgeHours,
    maxAgeHours,
    expectedProviderAddress,
    expectedSourceRevision,
  };
}

export function parseObservedAt(value: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new PassportGateValidationError("INVALID_OBSERVED_AT", "observedAt must be a valid timestamp.");
  }
  return timestamp;
}
