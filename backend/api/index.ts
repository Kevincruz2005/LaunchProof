/**
 * Vercel Serverless Entry Point for the LaunchProof backend.
 *
 * Vercel expects a default export that is a Node.js HTTP handler (IncomingMessage, ServerResponse).
 * Express apps satisfy this interface directly.
 *
 * On Vercel:
 *  - VERCEL=1 is automatically set by the runtime
 *  - NODE_ENV defaults to "production" unless overridden in Vercel env vars
 *  - We run with NODE_ENV=development to skip x402/production strict checks
 *  - ALLOW_LOCAL_UNPAID_RUNS=true lets callers trigger rehearsals without payment
 *  - DATABASE_URL should point to a Neon PostgreSQL connection string
 */
import { createApp } from "../src/rest/app.js";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/db/store.js";
import { PrismaRepository } from "../src/db/prisma-store.js";
import { LoggingRepository } from "../src/db/logging-store.js";
import { RegistryService } from "../src/chain/registry.js";

// Build the Express app once (module is cached between warm invocations)
let appCache: ReturnType<typeof createApp> | null = null;

async function getApp() {
  if (appCache) return appCache;

  const config = loadConfig();

  // Rebuild the on-chain index if registry is configured (non-blocking on first warm start)
  const repository = new LoggingRepository(
    config.DATABASE_URL ? new PrismaRepository() : new MemoryRepository(),
  );

  if (config.chainReady) {
    await new RegistryService(config).rebuildIndex(repository).catch(() => {
      // Non-fatal on Vercel — chain index rebuild may fail if RPC is unavailable
    });
  }

  appCache = createApp(config, repository);
  return appCache;
}

// Vercel calls this handler for every incoming request
export default async function handler(req: any, res: any) {
  const app = await getApp();
  app(req, res);
}
