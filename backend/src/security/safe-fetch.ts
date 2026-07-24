import { Agent, request } from "undici";
import type { Config } from "../config.js";
import { resolvePublic, validateTargetUrl } from "./network.js";

const MAX_RESPONSE_BYTES = 1_048_576;
const MAX_REDIRECTS = 3;

export interface SafeResponse {
  status: number;
  headers: Record<string, string>;
  text: string;
  url: string;
}

export class ResponseLimitError extends Error {}
export class UnsafeHeaderError extends Error {}

const ALLOWED_OUTBOUND_HEADERS = new Set([
  "accept",
  "content-type",
  "idempotency-key",
  "mcp-session-id",
  "payment",
  "payment-signature",
  "x-payment",
]);

export async function safeRequest(
  rawUrl: string,
  config: Pick<Config, "ALLOW_PRIVATE_TARGETS" | "fixtureUrls">,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<SafeResponse> {
  const outboundHeaders = sanitizeOutboundHeaders(init.headers ?? {});
  let current = validateTargetUrl(rawUrl, config.ALLOW_PRIVATE_TARGETS);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await resolvePublic(current, config.ALLOW_PRIVATE_TARGETS);
    const selected = addresses[0];
    if (!selected) throw new Error("No validated address available");
    const dispatcher = new Agent({
      connect: {
        servername: current.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, [selected]);
        },
      },
    });
    const timeoutSignal = AbortSignal.timeout(init.timeoutMs ?? 8_000);
    const signal = init.signal ? AbortSignal.any([timeoutSignal, init.signal]) : timeoutSignal;
    try {
      const fixtureTunnelHeaders = isConfiguredFixtureHost(current, config.fixtureUrls)
        ? { "bypass-tunnel-reminder": "true", "x-tunnel-skip-bypass": "true" }
        : {};
      const response = await request(current, {
        method: init.method ?? "GET",
        body: init.body,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "user-agent": "LaunchProof/1.0 bounded-rehearsal",
          ...fixtureTunnelHeaders,
          ...outboundHeaders,
        },
        headersTimeout: init.timeoutMs ?? 8_000,
        bodyTimeout: init.timeoutMs ?? 8_000,
        signal,
        dispatcher,
      });
      const headers: Record<string, string> = {};
      for (const [name, value] of Object.entries(response.headers)) {
        if (value !== undefined) headers[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : value;
      }
      if (response.statusCode >= 300 && response.statusCode < 400) {
        const location = headers.location;
        await response.body.dump();
        if (!location || redirect === MAX_REDIRECTS) throw new Error("Redirect limit exceeded");
        const redirected = validateTargetUrl(new URL(location, current).toString(), config.ALLOW_PRIVATE_TARGETS);
        validateSafeRedirect(current, redirected, init.method ?? "GET");
        current = redirected;
        continue;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        const bytes = Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          response.body.destroy();
          throw new ResponseLimitError("Target response exceeded 1 MB");
        }
        chunks.push(bytes);
      }
      return {
        status: response.statusCode,
        headers,
        text: Buffer.concat(chunks).toString("utf8"),
        url: current.toString(),
      };
    } finally {
      await dispatcher.close();
    }
  }
  throw new Error("Unreachable redirect state");
}

export function sanitizeOutboundHeaders(headers: Record<string, string>): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = rawName.trim().toLowerCase();
    if (!/^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || !ALLOWED_OUTBOUND_HEADERS.has(name)) {
      throw new UnsafeHeaderError(`Outbound header is not permitted: ${name || "invalid"}`);
    }
    if (/[\r\n\0]/.test(rawValue)) throw new UnsafeHeaderError(`Outbound header contains forbidden control characters: ${name}`);
    sanitized[name] = rawValue;
  }
  return sanitized;
}

export function validateSafeRedirect(current: URL, redirected: URL, method: "GET" | "POST"): void {
  if (method === "POST") throw new Error("Redirects are forbidden for POST and payment requests");
  if (current.origin !== redirected.origin) throw new Error("Cross-origin redirects are forbidden");
}

export async function fetchJson<T>(
  url: string,
  config: Pick<Config, "ALLOW_PRIVATE_TARGETS" | "fixtureUrls">,
  timeoutMs = 8_000,
): Promise<T> {
  const response = await safeRequest(url, config, { timeoutMs });
  if (response.status < 200 || response.status >= 300) throw new Error(`Target returned HTTP ${response.status}`);
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new Error("Target returned invalid JSON");
  }
}

function isConfiguredFixtureHost(url: URL, fixtureUrls: Config["fixtureUrls"]): boolean {
  return Object.values(fixtureUrls).some((fixtureUrl) => {
    if (!fixtureUrl) return false;
    try {
      return new URL(fixtureUrl).origin.toLowerCase() === url.origin.toLowerCase();
    } catch {
      return false;
    }
  });
}
