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

export async function safeRequest(
  rawUrl: string,
  config: Pick<Config, "ALLOW_PRIVATE_TARGETS">,
  init: {
    method?: "GET" | "POST";
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
  } = {},
): Promise<SafeResponse> {
  let current = validateTargetUrl(rawUrl, config.ALLOW_PRIVATE_TARGETS);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const addresses = await resolvePublic(current, config.ALLOW_PRIVATE_TARGETS);
    const selected = addresses[0];
    if (!selected) throw new Error("No validated address available");
    const dispatcher = new Agent({
      connect: {
        servername: current.hostname,
        lookup: (_hostname, _options, callback) => {
          callback(null, selected.address, selected.family);
        },
      },
    });
    const signal = AbortSignal.timeout(init.timeoutMs ?? 8_000);
    try {
      const response = await request(current, {
        method: init.method ?? "GET",
        body: init.body,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          "user-agent": "LaunchProof/1.0 bounded-rehearsal",
          ...init.headers,
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
        current = validateTargetUrl(new URL(location, current).toString(), config.ALLOW_PRIVATE_TARGETS);
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

export async function fetchJson<T>(
  url: string,
  config: Pick<Config, "ALLOW_PRIVATE_TARGETS">,
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
