import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const LOCK_NAMESPACE = 1952;
const LOCK_KEY = 5001;

export type LeaderCapability =
  | "inbound-payment"
  | "target-payment"
  | "registry-publication"
  | "payment-recovery"
  | "publication-recovery"
  | "run-execution"
  | "run-recovery"
  | "chain-index";

export interface LeadershipSnapshot {
  state: "disabled" | "standby" | "leader" | "lost" | "stopped";
  fence: string | null;
}

export class NotLeaderError extends Error {
  constructor(capability: LeaderCapability) {
    super(`Writer leadership is unavailable for ${capability}`);
    this.name = "NotLeaderError";
  }
}

export interface LeaderGuard {
  snapshot(): LeadershipSnapshot;
  assertLeader(capability: LeaderCapability): Promise<string>;
  signal(): AbortSignal;
}

export interface AdvisorySession {
  tryAcquire(holderId: string): Promise<boolean>;
  nextFence(holderId: string): Promise<bigint>;
  ownsLock(): Promise<boolean>;
  release(): Promise<void>;
  close(): Promise<void>;
}

export type LeadershipListener = (snapshot: LeadershipSnapshot, signal: AbortSignal) => void | Promise<void>;

export class LeaderCoordinator implements LeaderGuard {
  private current: LeadershipSnapshot = { state: "standby", fence: null };
  private controller = abortedController();
  private session: AdvisorySession | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private readonly listeners = new Set<LeadershipListener>();

  constructor(
    private readonly createSession: () => Promise<AdvisorySession>,
    private readonly holderId = randomUUID(),
    private readonly pollIntervalMs = 2_000,
  ) {}

  snapshot(): LeadershipSnapshot {
    return { ...this.current };
  }

  signal(): AbortSignal {
    return this.controller.signal;
  }

  onChange(listener: LeadershipListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.current.state === "stopped") throw new Error("Stopped leadership coordinator cannot restart");
    await this.pollNow();
    if (this.pollIntervalMs > 0 && !this.timer) {
      this.timer = setInterval(() => void this.pollNow(), this.pollIntervalMs);
      this.timer.unref();
    }
  }

  async pollNow(): Promise<void> {
    if (this.ticking || this.current.state === "stopped") return;
    this.ticking = true;
    try {
      if (this.current.state === "leader") {
        if (!this.session || !(await this.session.ownsLock())) await this.loseLeadership();
        return;
      }
      await this.acquire();
    } catch {
      await this.loseLeadership();
    } finally {
      this.ticking = false;
    }
  }

  async assertLeader(capability: LeaderCapability): Promise<string> {
    if (this.current.state !== "leader" || !this.current.fence || !this.session) throw new NotLeaderError(capability);
    try {
      if (!(await this.session.ownsLock())) {
        await this.loseLeadership();
        throw new NotLeaderError(capability);
      }
    } catch (error) {
      if (!(error instanceof NotLeaderError)) await this.loseLeadership();
      throw error instanceof NotLeaderError ? error : new NotLeaderError(capability);
    }
    return this.current.fence;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.controller.abort(new Error("Writer leadership stopped"));
    const session = this.session;
    this.session = null;
    this.current = { state: "stopped", fence: null };
    if (session) {
      await session.release().catch(() => undefined);
      await session.close().catch(() => undefined);
    }
    await this.notify();
  }

  private async acquire(): Promise<void> {
    if (!this.session) this.session = await this.createSession();
    if (!(await this.session.tryAcquire(this.holderId))) return;
    const fence = await this.session.nextFence(this.holderId);
    this.controller = new AbortController();
    this.current = { state: "leader", fence: fence.toString() };
    await this.notify();
  }

  private async loseLeadership(): Promise<void> {
    if (this.current.state === "stopped") return;
    const wasLeader = this.current.state === "leader";
    this.controller.abort(new Error("Writer leadership was lost"));
    const session = this.session;
    this.session = null;
    this.current = { state: wasLeader ? "lost" : "standby", fence: null };
    if (session) await session.close().catch(() => undefined);
    if (wasLeader) await this.notify();
    if (this.current.state !== "stopped") this.current = { state: "standby", fence: null };
  }

  private async notify(): Promise<void> {
    const snapshot = this.snapshot();
    const signal = this.controller.signal;
    await Promise.all([...this.listeners].map((listener) => Promise.resolve(listener(snapshot, signal))));
  }
}

export class AlwaysLeader implements LeaderGuard {
  private readonly controller = new AbortController();
  snapshot(): LeadershipSnapshot { return { state: "leader", fence: "local-single-process" }; }
  async assertLeader(_capability: LeaderCapability): Promise<string> { return "local-single-process"; }
  signal(): AbortSignal { return this.controller.signal; }
}

/**
 * Permanent fail-closed guard for a read-only deployment.
 *
 * This type has no session factory, start, poll, acquire, release, or takeover
 * method. It therefore cannot open a leadership database connection or issue
 * either advisory-lock or fencing SQL.
 */
export class ReadOnlyLeaderGuard implements LeaderGuard {
  private readonly controller = abortedController("Read-only backend mode permanently disables writer leadership");

  snapshot(): LeadershipSnapshot { return { state: "disabled", fence: null }; }

  async assertLeader(capability: LeaderCapability): Promise<string> {
    throw new NotLeaderError(capability);
  }

  signal(): AbortSignal { return this.controller.signal; }
}

export function createRuntimeLeadership(options: {
  backendMode: "writer" | "read-only";
  nodeEnv: "development" | "test" | "production";
  leadershipDatabaseUrl?: string;
  sessionFactory?: () => Promise<AdvisorySession>;
}): LeaderGuard {
  if (options.backendMode === "read-only") return new ReadOnlyLeaderGuard();
  if (options.nodeEnv !== "production") return new AlwaysLeader();
  if (!options.leadershipDatabaseUrl) throw new Error("Writer production mode requires LEADERSHIP_DATABASE_URL");
  return new LeaderCoordinator(
    options.sessionFactory ?? postgresAdvisorySessionFactory(options.leadershipDatabaseUrl),
  );
}

export function postgresAdvisorySessionFactory(databaseUrl: string): () => Promise<AdvisorySession> {
  return async () => {
    const client = new PrismaClient({ datasourceUrl: singleConnectionUrl(databaseUrl) });
    await client.$connect();
    return new PrismaAdvisorySession(client);
  };
}

export class PrismaAdvisorySession implements AdvisorySession {
  constructor(private readonly client: PrismaClient) {}

  async tryAcquire(_holderId: string): Promise<boolean> {
    const rows = await this.client.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_lock(${LOCK_NAMESPACE}::integer, ${LOCK_KEY}::integer) AS acquired
    `;
    return rows[0]?.acquired === true;
  }

  async nextFence(holderId: string): Promise<bigint> {
    const rows = await this.client.$queryRaw<Array<{ epoch: string | bigint }>>`
      INSERT INTO "WriterLeadership" ("id", "epoch", "holderId", "acquiredAt", "updatedAt")
      VALUES ('registry-writer', 1, ${holderId}, NOW(), NOW())
      ON CONFLICT ("id") DO UPDATE SET
        "epoch" = "WriterLeadership"."epoch" + 1,
        "holderId" = EXCLUDED."holderId",
        "acquiredAt" = NOW(),
        "updatedAt" = NOW()
      RETURNING "epoch"::text AS epoch
    `;
    if (rows[0]?.epoch === undefined) throw new Error("Writer fencing epoch was not persisted");
    return BigInt(rows[0].epoch);
  }

  async ownsLock(): Promise<boolean> {
    const rows = await this.client.$queryRaw<Array<{ held: boolean }>>`
      SELECT EXISTS (
        SELECT 1 FROM pg_locks
        WHERE locktype = 'advisory'
          AND pid = pg_backend_pid()
          AND classid = ${LOCK_NAMESPACE}::integer::oid
          AND objid = ${LOCK_KEY}::integer::oid
          AND granted
      ) AS held
    `;
    return rows[0]?.held === true;
  }

  async release(): Promise<void> {
    await this.client.$queryRaw`
      SELECT pg_advisory_unlock(${LOCK_NAMESPACE}::integer, ${LOCK_KEY}::integer)
    `;
  }

  async close(): Promise<void> {
    await this.client.$disconnect();
  }
}

function singleConnectionUrl(raw: string): string {
  const url = new URL(raw);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "5");
  return url.toString();
}

function abortedController(reason = "Writer leadership is not held"): AbortController {
  const controller = new AbortController();
  controller.abort(new Error(reason));
  return controller;
}
