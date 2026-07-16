/**
 * Vercel Serverless Entry Point — LaunchProof Backend
 *
 * Plain ESM JavaScript (.mjs) — avoids Vercel's built-in TypeScript type-checker
 * which cannot resolve backend/node_modules types from the monorepo root.
 *
 * Environment variables expected on Vercel:
 *   NODE_ENV=development                 (skip x402 production checks)
 *   ALLOW_LOCAL_UNPAID_RUNS=true         (allow x-launchproof-local-run header)
 *   DATABASE_URL=postgres://...          (Neon PostgreSQL connection string)
 *   PUBLIC_API_BASE_URL=https://...      (your Vercel backend URL)
 *   PUBLIC_WEB_BASE_URL=https://...      (your Vercel frontend URL)
 *   XLAYER_RPC_URL=https://testrpc...    (optional, enables chain reads)
 *   REGISTRY_ADDRESS=0x...               (optional, enables chain reads)
 *   REGISTRY_DEPLOYMENT_BLOCK=35663616   (optional)
 *   BUILD_COMMIT_SHA=<your git sha>      (optional, defaults to "development")
 *   SOURCE_REPOSITORY=https://github.com/... (your repo URL)
 */
import { createApp } from "../backend/src/rest/app.js";
import { loadConfig } from "../backend/src/config.js";
import { MemoryRepository } from "../backend/src/db/store.js";
import { PrismaRepository } from "../backend/src/db/prisma-store.js";
import { LoggingRepository } from "../backend/src/db/logging-store.js";
import { RegistryService } from "../backend/src/chain/registry.js";

// Module-level cache: reused across warm Vercel invocations
let appPromise = null;

function buildApp() {
  if (appPromise) return appPromise;
  appPromise = (async () => {
    const config = loadConfig();
    const repository = new LoggingRepository(
      config.DATABASE_URL ? new PrismaRepository() : new MemoryRepository(),
    );
    if (config.chainReady) {
      await new RegistryService(config).rebuildIndex(repository).catch(() => {
        // Non-fatal: chain index rebuild may fail if RPC unavailable at cold start
      });
    }
    return createApp(config, repository);
  })();
  return appPromise;
}

export default async function handler(req, res) {
  const app = await buildApp();
  app(req, res);
}
