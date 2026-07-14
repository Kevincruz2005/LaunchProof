import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

export function toJcs(value: unknown): string {
  return canonicalize(value);
}

export function sha256(value: string | Uint8Array): `0x${string}` {
  return `0x${createHash("sha256").update(value).digest("hex")}`;
}

export function hashJcs(value: unknown): `0x${string}` {
  return sha256(toJcs(value));
}
