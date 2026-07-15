import { lookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

export class UnsafeTargetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeTargetError";
  }
}

export function isPublicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()) {
      return isPublicAddress((parsed as ipaddr.IPv6).toIPv4Address().toString());
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

export function validateTargetUrl(raw: string, allowPrivate = false): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UnsafeTargetError("Target is not a valid URL");
  }
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) throw new UnsafeTargetError("Only public HTTPS targets are allowed");
  if (url.username || url.password) throw new UnsafeTargetError("URL credentials are forbidden");
  if (url.port && url.port !== "443" && !allowPrivate) throw new UnsafeTargetError("Non-standard HTTPS ports are forbidden");
  if (url.hostname.endsWith(".local") || url.hostname.endsWith(".internal")) {
    throw new UnsafeTargetError("Local hostnames are forbidden");
  }
  if (ipaddr.isValid(url.hostname) && !allowPrivate && !isPublicAddress(url.hostname)) {
    throw new UnsafeTargetError("Private, reserved, or special-use addresses are forbidden");
  }
  return url;
}

export async function resolvePublic(url: URL, allowPrivate = false) {
  const answers = await lookup(url.hostname, { all: true, verbatim: true });
  if (answers.length === 0) throw new UnsafeTargetError("Target hostname has no A or AAAA records");
  if (!allowPrivate) {
    const blocked = answers.find((answer) => !isPublicAddress(answer.address));
    if (blocked) throw new UnsafeTargetError(`Target resolved to forbidden address range (${blocked.family})`);
  }
  return answers;
}
