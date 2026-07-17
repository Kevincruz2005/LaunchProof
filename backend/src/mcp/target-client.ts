import type { Config } from "../config.js";
import { safeRequest } from "../security/safe-fetch.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
}

export const SUPPORTED_MCP_PROTOCOL_VERSION = "2025-06-18" as const;

export interface McpInitialization {
  protocolVersion: typeof SUPPORTED_MCP_PROTOCOL_VERSION;
  capabilities: { tools: Record<string, unknown> };
  serverInfo: { name: string; version: string };
}

export interface ToolDescription {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface ToolResult {
  output: Record<string, unknown> | null;
  structuredError: { code: number | string; message: string } | null;
}

export function parseRpcPayload(text: string, contentType: string | undefined, expectedId: number): JsonRpcResponse {
  const value = contentType?.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim()
    : text;
  if (!value) throw new Error("MCP target returned an empty response");
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("MCP target returned invalid JSON");
  }
  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") throw new Error("MCP response must use JSON-RPC 2.0");
  if (parsed.id !== expectedId) throw new Error("MCP response ID did not match the request");
  const result = parsed.result;
  const error = parsed.error;
  if (result !== undefined && !isRecord(result)) throw new Error("MCP response result must be an object");
  if (error !== undefined) {
    if (!isRecord(error) || typeof error.code !== "number" || !Number.isInteger(error.code) ||
      typeof error.message !== "string" || error.message.length > 500) {
      throw new Error("MCP response contained a malformed error");
    }
  }
  if ((result === undefined) === (error === undefined)) {
    throw new Error("MCP response must contain exactly one of result or error");
  }
  return {
    jsonrpc: "2.0",
    id: expectedId,
    ...(result ? { result } : {}),
    ...(error ? { error: { code: error.code as number, message: error.message as string } } : {}),
  };
}

function normalizedToolOutput(result: Record<string, unknown>): Record<string, unknown> | null {
  const structured = result.structuredContent;
  if (structured && typeof structured === "object" && !Array.isArray(structured)) return structured as Record<string, unknown>;
  const content = result.content;
  if (!Array.isArray(content)) return null;
  const textItem = content.find(
    (item): item is { type: "text"; text: string } =>
      Boolean(item && typeof item === "object" && (item as { type?: unknown }).type === "text" && typeof (item as { text?: unknown }).text === "string"),
  );
  if (!textItem || textItem.text.length > 65_536) return null;
  try {
    const parsed = JSON.parse(textItem.text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export class McpTargetClient {
  private sessionId: string | undefined;
  private nextId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly config: Pick<Config, "ALLOW_PRIVATE_TARGETS" | "fixtureUrls">,
    private readonly timeoutMs: number,
    private readonly deadlineAt: number,
  ) {}

  async initialize(): Promise<McpInitialization> {
    const response = await this.rpc("initialize", {
      protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "LaunchProof", version: "1.0.0" },
    });
    const initialization = parseInitialization(response);
    await this.notification("notifications/initialized");
    return initialization;
  }

  async listTools(): Promise<ToolDescription[]> {
    const result = await this.rpc("tools/list", {});
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new Error("MCP tools/list omitted tools");
    if (tools.length > 20) throw new Error("MCP tools/list exceeded the bounded tool count");
    const parsed = tools.map(parseToolDescription);
    if (new Set(parsed.map((tool) => tool.name)).size !== parsed.length) {
      throw new Error("MCP tools/list contained duplicate tool names");
    }
    return parsed;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.rpc("tools/call", { name, arguments: args });
      if (result.isError === true) {
        const message = boundedToolError(result.content);
        return { output: null, structuredError: { code: "TOOL_ERROR", message } };
      }
      const output = normalizedToolOutput(result);
      return output
        ? { output, structuredError: null }
        : { output: null, structuredError: { code: "INVALID_OUTPUT", message: "Tool did not return a JSON object" } };
    } catch (error) {
      const message = error instanceof Error ? error.message : "MCP tool call failed";
      return { output: null, structuredError: { code: "MCP_ERROR", message: message.slice(0, 500) } };
    }
  }

  private async rpc(method: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const response = await safeRequest(this.endpoint, this.config, {
      method: "POST",
      timeoutMs: this.boundedTimeout(),
      headers: {
        accept: "application/json, text/event-stream",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (response.status < 200 || response.status >= 300) throw new Error(`MCP target returned HTTP ${response.status}`);
    this.captureSessionId(response.headers["mcp-session-id"]);
    const payload = parseRpcPayload(response.text, response.headers["content-type"], id);
    if (payload.error) throw new Error(`MCP ${payload.error.code}: ${payload.error.message.slice(0, 300)}`);
    if (!payload.result) throw new Error("MCP response omitted result");
    return payload.result;
  }

  private async notification(method: string): Promise<void> {
    const response = await safeRequest(this.endpoint, this.config, {
      method: "POST",
      timeoutMs: this.boundedTimeout(),
      headers: this.sessionId ? { "mcp-session-id": this.sessionId } : {},
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`MCP notification returned HTTP ${response.status}`);
    }
    this.captureSessionId(response.headers["mcp-session-id"]);
  }

  private captureSessionId(value: string | undefined): void {
    if (value === undefined) return;
    if (!/^[\x21-\x7e]{1,128}$/.test(value)) throw new Error("MCP target returned an invalid session identifier");
    this.sessionId = value;
  }

  private boundedTimeout(): number {
    return Math.max(1, Math.min(this.timeoutMs, Math.floor(this.deadlineAt - performance.now())));
  }
}

function parseInitialization(value: Record<string, unknown>): McpInitialization {
  if (value.protocolVersion !== SUPPORTED_MCP_PROTOCOL_VERSION) {
    throw new Error(`MCP target did not negotiate ${SUPPORTED_MCP_PROTOCOL_VERSION}`);
  }
  if (!isRecord(value.capabilities) || !isRecord(value.capabilities.tools)) {
    throw new Error("MCP target did not advertise the tools capability");
  }
  if (!isRecord(value.serverInfo) || typeof value.serverInfo.name !== "string" ||
    value.serverInfo.name.length < 1 || value.serverInfo.name.length > 120 ||
    typeof value.serverInfo.version !== "string" || value.serverInfo.version.length < 1 || value.serverInfo.version.length > 80) {
    throw new Error("MCP target returned invalid bounded serverInfo");
  }
  return {
    protocolVersion: SUPPORTED_MCP_PROTOCOL_VERSION,
    capabilities: { tools: {} },
    serverInfo: { name: value.serverInfo.name, version: value.serverInfo.version },
  };
}

export function parseToolDescription(value: unknown): ToolDescription {
  if (!isRecord(value)) throw new Error("MCP tools/list contained a malformed tool");
  assertOnlyKeys(value, ["name", "description", "inputSchema"], "tool");
  if (typeof value.name !== "string" || value.name.length < 1 || value.name.length > 80) {
    throw new Error("MCP tool name must be between 1 and 80 characters");
  }
  if (value.description !== undefined && (typeof value.description !== "string" || value.description.length > 500)) {
    throw new Error("MCP tool description exceeded the bounded profile");
  }
  return {
    name: value.name,
    ...(typeof value.description === "string" ? { description: value.description } : {}),
    inputSchema: parseInputSchema(value.inputSchema),
  };
}

function parseInputSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("MCP tool inputSchema must be an object");
  assertOnlyKeys(value, ["type", "properties", "required", "anyOf", "additionalProperties"], "inputSchema");
  if (value.type !== "object" || value.additionalProperties !== false || !isRecord(value.properties)) {
    throw new Error("MCP tool inputSchema must be a closed object schema");
  }
  const propertyEntries = Object.entries(value.properties);
  if (propertyEntries.length < 1 || propertyEntries.length > 20) {
    throw new Error("MCP tool inputSchema properties exceeded the bounded profile");
  }
  const properties: Record<string, unknown> = {};
  for (const [name, definition] of propertyEntries) {
    if (!/^[A-Za-z0-9_]{1,80}$/.test(name)) throw new Error("MCP input property name is invalid");
    properties[name] = parsePropertySchema(definition);
  }
  const required = value.required === undefined ? undefined : parseRequired(value.required, properties);
  let anyOf: Array<{ required: string[] }> | undefined;
  if (value.anyOf !== undefined) {
    if (!Array.isArray(value.anyOf) || value.anyOf.length < 1 || value.anyOf.length > 10) {
      throw new Error("MCP inputSchema anyOf exceeded the bounded profile");
    }
    anyOf = value.anyOf.map((branch) => {
      if (!isRecord(branch)) throw new Error("MCP inputSchema anyOf branch is malformed");
      assertOnlyKeys(branch, ["required"], "inputSchema anyOf branch");
      return { required: parseRequired(branch.required, properties) };
    });
    const fingerprints = anyOf.map((branch) => [...branch.required].sort().join("\0"));
    if (new Set(fingerprints).size !== fingerprints.length) throw new Error("MCP inputSchema repeated an anyOf branch");
  }
  if (!required && !anyOf) throw new Error("MCP inputSchema must declare required input fields");
  return {
    type: "object",
    properties,
    ...(required ? { required } : {}),
    ...(anyOf ? { anyOf } : {}),
    additionalProperties: false,
  };
}

function parsePropertySchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error("MCP input property schema is malformed");
  assertOnlyKeys(value, ["type", "maxLength", "minimum", "maximum"], "input property schema");
  if (value.type === "string") {
    if (!Number.isInteger(value.maxLength) || (value.maxLength as number) < 1 || (value.maxLength as number) > 5_000 ||
      value.minimum !== undefined || value.maximum !== undefined) {
      throw new Error("MCP string input requires maxLength between 1 and 5000");
    }
    return { type: "string", maxLength: value.maxLength };
  }
  if (value.type !== "number" && value.type !== "integer" && value.type !== "boolean") {
    throw new Error("MCP input property type is unsupported");
  }
  if (value.maxLength !== undefined) throw new Error("MCP non-string input cannot declare maxLength");
  const bounds: Record<string, number> = {};
  for (const key of ["minimum", "maximum"] as const) {
    const bound = value[key];
    if (bound !== undefined) {
      if (typeof bound !== "number" || !Number.isFinite(bound)) throw new Error("MCP numeric input bound must be finite");
      bounds[key] = bound;
    }
  }
  if (value.type === "boolean" && Object.keys(bounds).length > 0) throw new Error("MCP boolean input cannot declare numeric bounds");
  if (bounds.minimum !== undefined && bounds.maximum !== undefined && bounds.minimum > bounds.maximum) {
    throw new Error("MCP numeric input bounds are inconsistent");
  }
  return { type: value.type, ...bounds };
}

function parseRequired(value: unknown, properties: Record<string, unknown>): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20 ||
    value.some((field) => typeof field !== "string" || !Object.hasOwn(properties, field))) {
    throw new Error("MCP inputSchema required fields are malformed");
  }
  const fields = value as string[];
  if (new Set(fields).size !== fields.length) throw new Error("MCP inputSchema repeated a required field");
  return [...fields];
}

function boundedToolError(value: unknown): string {
  if (Array.isArray(value)) {
    const text = value.find((item) => isRecord(item) && item.type === "text" && typeof item.text === "string");
    if (text && typeof text.text === "string") return text.text.slice(0, 500);
  }
  return "structured tool error";
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowlist = new Set(allowed);
  if (Object.keys(value).some((key) => !allowlist.has(key))) throw new Error(`MCP ${label} contained unsupported fields`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
