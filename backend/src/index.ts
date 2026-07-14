import { createApp } from "./rest/app.js";
import { loadConfig } from "./config.js";
import { MemoryRepository } from "./db/store.js";
import { PrismaRepository } from "./db/prisma-store.js";
import { validateProductionChain } from "./chain/preflight.js";
import { RegistryService } from "./chain/registry.js";
import { LoggingRepository } from "./db/logging-store.js";

async function main() {
  const config = loadConfig();
  await validateProductionChain(config);
  const repository = new LoggingRepository(config.DATABASE_URL ? new PrismaRepository() : new MemoryRepository());
  const rebuilt = await new RegistryService(config).rebuildIndex(repository);
  if (config.productionReady) process.stdout.write(JSON.stringify({ event: "chain_index_rebuilt", records: rebuilt }) + "\n");
  const app = createApp(config, repository);
  app.listen(config.PORT, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({ event: "server_started", port: config.PORT, build: config.BUILD_COMMIT_SHA, production_ready: config.productionReady }) + "\n",
    );
  });
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Startup failed"}\n`);
  process.exit(1);
});
