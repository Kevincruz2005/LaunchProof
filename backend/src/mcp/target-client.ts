import type { Config } from "../config.js";
import { safeRequest } from "../security/safe-fetch.js";

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
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

function parsePayload(text: string, contentType: string | undefined): JsonRpcResponse {
  const value = contentType?.includes("text/event-stream")
    ? text
        .split(/\r?\n/)
        .find((line) => line.startsWith("data:"))
        ?.slice(5)
        .trim()
    : text;
  if (!value) throw new Error("MCP target returned an empty response");
  return JSON.parse(value) as JsonRpcResponse;
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
  if (!textItem) return null;
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
    private readonly config: Pick<Config, "ALLOW_PRIVATE_TARGETS">,
    private readonly timeoutMs: number,
    private readonly deadlineAt: number,
  ) {}

  async initialize(): Promise<Record<string, unknown>> {
    const response = await this.rpc("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "LaunchProof", version: "1.0.0" },
    });
    await this.notification("notifications/initialized");
    return response;
  }

  async listTools(): Promise<ToolDescription[]> {
    const result = await this.rpc("tools/list", {});
    const tools = result.tools;
    if (!Array.isArray(tools)) throw new Error("MCP tools/list omitted tools");
    return tools.filter((tool): tool is ToolDescription => {
      return Boolean(tool && typeof tool === "object" && typeof (tool as { name?: unknown }).name === "string");
    });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await this.rpc("tools/call", { name, arguments: args });
      if (result.isError === true) {
        const message = JSON.stringify(result.content ?? "structured tool error").slice(0, 500);
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
    this.sessionId = response.headers["mcp-session-id"] ?? this.sessionId;
    const payload = parsePayload(response.text, response.headers["content-type"]);
    if (payload.error) throw new Error(`MCP ${payload.error.code}: ${payload.error.message.slice(0, 300)}`);
    if (!payload.result) throw new Error("MCP response omitted result");
    return payload.result;
  }

  private async notification(method: string): Promise<void> {
    await safeRequest(this.endpoint, this.config, {
      method: "POST",
      timeoutMs: this.boundedTimeout(),
      headers: this.sessionId ? { "mcp-session-id": this.sessionId } : {},
      body: JSON.stringify({ jsonrpc: "2.0", method }),
    });
  }

  private boundedTimeout(): number {
    return Math.max(1, Math.min(this.timeoutMs, Math.floor(this.deadlineAt - performance.now())));
  }
}
