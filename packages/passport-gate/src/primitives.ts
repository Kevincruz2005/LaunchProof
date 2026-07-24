import ipaddr from "ipaddr.js";
import { canonicalize } from "json-canonicalize";
import { getAddress, isAddress, sha256, stringToHex } from "viem";

import { PassportGateValidationError } from "./errors.js";
import {
  gateNames,
  type Address,
  type ContractIdentity,
  type GateResults,
  type Hex,
} from "./types.js";

const SHA_REVISION = /^[0-9a-f]{40}$/i;
const BYTES32 = /^0x[0-9a-f]{64}$/i;

export function toJcs(value: unknown): string {
  return canonicalize(value);
}

export function hashText(value: string): Hex {
  return sha256(stringToHex(value));
}

export function hashJcs(value: unknown): Hex {
  return hashText(toJcs(value));
}

export function normalizeAddress(value: string): Address {
  if (!isAddress(value, { strict: false }) || /^0x0{40}$/i.test(value)) {
    throw new PassportGateValidationError("INVALID_PROVIDER_ADDRESS", "Expected a valid EVM address.");
  }
  return getAddress(value).toLowerCase() as Address;
}

export function normalizeBytes32(value: string): Hex {
  if (!BYTES32.test(value)) {
    throw new PassportGateValidationError("INVALID_CONFIGURATION", "Expected a 32-byte hexadecimal hash.");
  }
  return value.toLowerCase() as Hex;
}

export function normalizeSourceRevision(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_REVISION.test(normalized)) {
    throw new PassportGateValidationError(
      "INVALID_SOURCE_REVISION",
      "Source revision must be a full 40-character hexadecimal Git SHA.",
    );
  }
  return normalized;
}

function isPublicLiteralAddress(hostname: string): boolean {
  const candidate = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (!ipaddr.isValid(candidate)) return true;
  const parsed = ipaddr.process(candidate);
  return parsed.range() === "unicast";
}

export function normalizePublicHttpsUrl(value: string, field = "launch_contract_url"): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new PassportGateValidationError("INVALID_LAUNCH_CONTRACT_URL", `${field} must be an absolute URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new PassportGateValidationError("UNSAFE_LAUNCH_CONTRACT_URL", `${field} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new PassportGateValidationError("UNSAFE_LAUNCH_CONTRACT_URL", `${field} must not contain credentials.`);
  }
  if (parsed.port && parsed.port !== "443") {
    throw new PassportGateValidationError("UNSAFE_LAUNCH_CONTRACT_URL", `${field} must use the standard HTTPS port.`);
  }
  if (parsed.search || parsed.hash) {
    throw new PassportGateValidationError("INVALID_LAUNCH_CONTRACT_URL", `${field} must not contain a query or fragment.`);
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    !isPublicLiteralAddress(hostname)
  ) {
    throw new PassportGateValidationError("UNSAFE_LAUNCH_CONTRACT_URL", `${field} must target a public host.`);
  }

  parsed.hostname = hostname;
  parsed.port = "";
  return parsed.toString();
}

export function makeContractIdentity(input: {
  launchContractUrl: string;
  manifestHash: string;
  providerAddress: string;
  sourceRevision: string;
}): ContractIdentity {
  const identityMaterial = {
    launch_contract_url: normalizePublicHttpsUrl(input.launchContractUrl),
    manifest_hash: normalizeBytes32(input.manifestHash),
    provider_address: normalizeAddress(input.providerAddress),
    source_revision: normalizeSourceRevision(input.sourceRevision),
  };
  return {
    launchContractUrl: identityMaterial.launch_contract_url,
    manifestHash: identityMaterial.manifest_hash,
    providerAddress: identityMaterial.provider_address,
    sourceRevision: identityMaterial.source_revision,
    identityHash: hashJcs(identityMaterial),
  };
}

const gateBits: Record<(typeof gateNames)[number], number> = {
  discoverable: 0,
  contract_correct: 2,
  fresh_challenge: 4,
  safe_to_rehearse: 6,
  paid_delivery: 8,
};

export function encodeGateBitmap(gates: GateResults): bigint {
  return gateNames.reduce((bitmap, gate) => (gates[gate] ? bitmap | (1n << BigInt(gateBits[gate])) : bitmap), 0n);
}

export function decodeGateBitmap(bitmap: bigint): GateResults {
  if (bitmap < 0n) throw new RangeError("Gate bitmap cannot be negative.");
  return Object.fromEntries(
    gateNames.map((gate) => [gate, (bitmap & (1n << BigInt(gateBits[gate]))) !== 0n]),
  ) as unknown as GateResults;
}

export function formatAtomicAmount(amountAtomic: bigint, decimals: number): string {
  if (amountAtomic < 0n) throw new RangeError("Amount cannot be negative.");
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("Decimals must be an integer from 0 through 255.");
  }
  if (decimals === 0) return amountAtomic.toString();
  const padded = amountAtomic.toString().padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals);
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

export function parseDisplayAmount(amountDisplay: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new RangeError("Decimals must be an integer from 0 through 255.");
  }
  if (!/^(0|[1-9]\d*)(\.\d+)?$/.test(amountDisplay)) throw new RangeError("Invalid decimal amount.");
  const [whole = "0", fraction = ""] = amountDisplay.split(".");
  if (fraction.length > decimals) throw new RangeError("Amount has more precision than the asset supports.");
  return BigInt(`${whole}${fraction.padEnd(decimals, "0")}`);
}
