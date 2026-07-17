import { createApp } from "./rest/app.js";
import { loadConfig } from "./config.js";
import { MemoryRepository } from "./db/store.js";
import { PrismaRepository } from "./db/prisma-store.js";
import { validateProductionChain } from "./chain/preflight.js";
import { RegistryService } from "./chain/registry.js";
import { LoggingRepository } from "./db/logging-store.js";
import { RehearsalService } from "./workers/rehearsal.js";
import { reconcilePendingLaunchPayments } from "./payments/inbound.js";
import { reconcilePendingTargetPayments } from "./payments/target.js";

async function main() {
  const config = loadConfig();
  await validateProductionChain(config);
  const repository = new LoggingRepository(config.DATABASE_URL ? new PrismaRepository() : new MemoryRepository());
  const registry = new RegistryService(config);
  const rebuilt = await registry.rebuildIndex(repository);
  if (config.productionReady) process.stdout.write(JSON.stringify({ event: "chain_index_rebuilt", records: rebuilt }) + "\n");
  const reconciled = await registry.reconcilePendingPublications(repository);
  if (reconciled > 0) process.stdout.write(JSON.stringify({ event: "chain_publications_reconciled", records: reconciled }) + "\n");
  const paymentsReconciled = await reconcilePendingLaunchPayments(config, repository);
  if (paymentsReconciled > 0) {
    process.stdout.write(JSON.stringify({ event: "launch_payments_reconciled", records: paymentsReconciled }) + "\n");
  }
  const targetPaymentsReconciled = await reconcilePendingTargetPayments(config, repository);
  if (targetPaymentsReconciled > 0) {
    process.stdout.write(JSON.stringify({ event: "target_payments_reconciled", records: targetPaymentsReconciled }) + "\n");
  }
  const recovered = await new RehearsalService(config, repository).recoverPendingRuns();
  if (recovered > 0) process.stdout.write(JSON.stringify({ event: "runs_recovered", records: recovered }) + "\n");
  const app = createApp(config, repository, { startupPreflightPassed: true });
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
