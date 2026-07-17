import type { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Repository } from "../db/store.js";
import { RehearsalService } from "../workers/rehearsal.js";
import {
  idempotencyKeySchema,
  isAuthorizedLocalRun,
  launchPaymentReference,
  previousRunIdSchema,
  rehearsalTargetSchemaFor,
} from "../payments/inbound.js";
import { RegistryService } from "../chain/registry.js";

type McpMode = "rehearse" | "renew" | "public";

export async function handleMcp(
  request: Request,
  response: Response,
  mode: McpMode,
  service: RehearsalService,
  repository: Repository,
  config: Config,
) {
  const body = aliasBody(request.body);
  const server = new McpServer({ name: "LaunchProof", version: "1.0.0" });
  if (mode === "public") {
    server.registerTool(
      "get_service_passport",
      {
        description: "Retrieve a free, public LaunchProof Service Passport by run ID.",
        inputSchema: { run_id: z.string().min(1).max(100) },
      },
      async ({ run_id }) => {
        const cached = await repository.getRun(run_id);
        const cache = cached && "canonical_evidence" in cached ? cached : null;
        const chainRun = config.chainReady ? await new RegistryService(config).readPublishedRun(run_id, cache) : null;
        const run = config.chainReady
          ? chainRun ?? (cached && !("canonical_evidence" in cached) ? cached : null)
          : cached;
        if (!run) return { content: [{ type: "text", text: "Run not found" }], isError: true };
        return { content: [{ type: "text", text: JSON.stringify(run) }] };
      },
    );
  } else {
    server.registerTool(
      "rehearse_launch_contract",
      {
        description: mode === "renew" ? "Renew a Passport after a contract or source revision changes." : "Run a bounded Launch Contract rehearsal.",
        inputSchema: {
          url: rehearsalTargetSchemaFor(config.ALLOW_PRIVATE_TARGETS),
          idempotency_key: idempotencyKeySchema,
          previous_run_id: previousRunIdSchema.optional(),
        },
      },
      async ({ url, idempotency_key, previous_run_id }) => {
        if (mode === "renew" && !previous_run_id) {
          return { content: [{ type: "text", text: "previous_run_id is required for renewals" }], isError: true };
        }
        if (mode === "rehearse" && previous_run_id) {
          return { content: [{ type: "text", text: "Use /mcp/renew when previous_run_id is supplied" }], isError: true };
        }
        const price = mode === "renew" ? "0.10" : "0.01";
        const operation = mode === "renew" ? "renewal" : "genesis";
        const run = await service.reserve(url, idempotency_key, operation, previous_run_id ?? null);
        if (run.state === "payment_required" && isAuthorizedLocalRun(request, config)) {
          const payment = await launchPaymentReference(request, response, price, request.path, config);
          await service.runReserved(
            run.run_id,
            { url, idempotency_key, payment, ...(previous_run_id ? { previous_run_id } : {}) },
            false,
          );
        }
        return { content: [{ type: "text", text: JSON.stringify(run) }] };
      },
    );
  }
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  response.on("close", () => {
    void transport.close();
    void server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(request, response, body);
}

function aliasBody(input: unknown): unknown {
  if (!input || typeof input !== "object") return input;
  const body = structuredClone(input) as { method?: unknown; params?: { name?: unknown } };
  if (body.method === "tools/call" && body.params?.name === "preflight_service") {
    body.params.name = "rehearse_launch_contract";
  }
  if (body.method === "tools/call" && body.params?.name === "get_run") {
    body.params.name = "get_service_passport";
  }
  return body;
}
