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
import {
  AlwaysLeader,
  LeaderCoordinator,
  postgresAdvisorySessionFactory,
  type LeaderGuard,
  type LeadershipSnapshot,
} from "./leadership/leader.js";

async function main() {
  const config = loadConfig();
  await validateProductionChain(config);
  const repository = new LoggingRepository(config.DATABASE_URL ? new PrismaRepository() : new MemoryRepository());
  const leadership: LeaderGuard = config.NODE_ENV === "production"
    ? new LeaderCoordinator(postgresAdvisorySessionFactory(config.LEADERSHIP_DATABASE_URL!))
    : new AlwaysLeader();
  const registry = new RegistryService(config, leadership);
  const rehearsal = new RehearsalService(config, repository, leadership);
  const runLeaderStartup = async (snapshot: LeadershipSnapshot) => {
    if (snapshot.state !== "leader") return;
    await leadership.assertLeader("chain-index");
    const rebuilt = await registry.rebuildIndex(repository);
    if (config.productionReady) process.stdout.write(JSON.stringify({ event: "chain_index_rebuilt", records: rebuilt, fence: snapshot.fence }) + "\n");
    const reconciled = await registry.reconcilePendingPublications(repository);
    if (reconciled > 0) process.stdout.write(JSON.stringify({ event: "chain_publications_reconciled", records: reconciled, fence: snapshot.fence }) + "\n");
    const paymentsReconciled = await reconcilePendingLaunchPayments(config, repository, leadership);
    if (paymentsReconciled > 0) process.stdout.write(JSON.stringify({ event: "launch_payments_reconciled", records: paymentsReconciled, fence: snapshot.fence }) + "\n");
    const targetPaymentsReconciled = await reconcilePendingTargetPayments(config, repository, leadership);
    if (targetPaymentsReconciled > 0) process.stdout.write(JSON.stringify({ event: "target_payments_reconciled", records: targetPaymentsReconciled, fence: snapshot.fence }) + "\n");
    const recovered = await rehearsal.recoverPendingRuns();
    if (recovered > 0) process.stdout.write(JSON.stringify({ event: "runs_recovered", records: recovered, fence: snapshot.fence }) + "\n");
  };
  if (leadership instanceof LeaderCoordinator) {
    leadership.onChange((snapshot) => runLeaderStartup(snapshot));
    await leadership.start();
  } else {
    await runLeaderStartup(leadership.snapshot());
  }
  const app = createApp(config, repository, { startupPreflightPassed: true, leadership });
  const server = app.listen(config.PORT, "0.0.0.0", () => {
    process.stdout.write(
      JSON.stringify({ event: "server_started", port: config.PORT, build: config.BUILD_COMMIT_SHA, production_ready: config.productionReady, writer: leadership.snapshot() }) + "\n",
    );
  });

  // X Layer can confirm a valid publication after the request-side receipt wait
  // expires. Keep reconciling the persisted, signed candidate so a mined
  // transaction becomes a completed passport without requiring a redeploy.
  let publicationReconciliationRunning = false;
  const publicationReconciliationTimer = setInterval(() => {
    if (publicationReconciliationRunning || leadership.snapshot().state !== "leader") return;
    publicationReconciliationRunning = true;
    void leadership.assertLeader("publication-recovery")
      .then(() => registry.reconcilePendingPublications(repository))
      .then((records) => {
        if (records > 0) process.stdout.write(JSON.stringify({ event: "chain_publications_reconciled", records }) + "\n");
      })
      .catch((error: unknown) => {
        process.stderr.write(JSON.stringify({
          event: "chain_publication_reconciliation_failed",
          error_type: error instanceof Error ? error.name : "UnknownError",
        }) + "\n");
      })
      .finally(() => {
        publicationReconciliationRunning = false;
      });
  }, 30_000);
  publicationReconciliationTimer.unref();
  const shutdown = () => {
    clearInterval(publicationReconciliationTimer);
    server.close(() => undefined);
    if (leadership instanceof LeaderCoordinator) void leadership.stop();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Startup failed"}\n`);
  process.exit(1);
});
