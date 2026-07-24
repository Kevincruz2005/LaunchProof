import { describe, expect, it } from "vitest";
import {
  LeaderCoordinator,
  NotLeaderError,
  type AdvisorySession,
} from "../src/leadership/leader.js";

class IsolatedAdvisoryDatabase {
  owner: FakeSession | null = null;
  epoch = 0n;
  sessions = 0;

  factory = async (): Promise<AdvisorySession> => {
    this.sessions += 1;
    return new FakeSession(this);
  };
}

class FakeSession implements AdvisorySession {
  closed = false;
  connected = true;

  constructor(private readonly database: IsolatedAdvisoryDatabase) {}

  async tryAcquire(): Promise<boolean> {
    if (!this.connected || this.closed) throw new Error("session unavailable");
    if (this.database.owner && this.database.owner !== this) return false;
    this.database.owner = this;
    return true;
  }

  async nextFence(): Promise<bigint> {
    if (this.database.owner !== this) throw new Error("lock not held");
    this.database.epoch += 1n;
    return this.database.epoch;
  }

  async ownsLock(): Promise<boolean> {
    if (!this.connected || this.closed) throw new Error("connection lost");
    return this.database.owner === this;
  }

  async release(): Promise<void> {
    if (this.database.owner === this) this.database.owner = null;
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.database.owner === this) this.database.owner = null;
  }

  disconnect(): void {
    this.connected = false;
    if (this.database.owner === this) this.database.owner = null;
  }
}

describe("writer leadership and fencing", () => {
  it("elects exactly one leader across concurrent processes", async () => {
    const database = new IsolatedAdvisoryDatabase();
    const processes = Array.from({ length: 12 }, (_, index) =>
      new LeaderCoordinator(database.factory, `process-${index}`, 0));
    await Promise.all(processes.map((process) => process.start()));
    expect(processes.filter((process) => process.snapshot().state === "leader")).toHaveLength(1);
    expect(processes.filter((process) => process.snapshot().state !== "leader")).toHaveLength(11);
    await Promise.all(processes.map((process) => process.stop()));
  });

  it("fences the loser and advances a monotonic epoch before takeover", async () => {
    const database = new IsolatedAdvisoryDatabase();
    const first = new LeaderCoordinator(database.factory, "first", 0);
    const second = new LeaderCoordinator(database.factory, "second", 0);
    await first.start();
    await second.start();
    expect(first.snapshot()).toEqual({ state: "leader", fence: "1" });
    await expect(second.assertLeader("registry-publication")).rejects.toBeInstanceOf(NotLeaderError);

    const firstSignal = first.signal();
    await first.stop();
    expect(firstSignal.aborted).toBe(true);
    await second.pollNow();
    expect(second.snapshot()).toEqual({ state: "leader", fence: "2" });
    await expect(second.assertLeader("registry-publication")).resolves.toBe("2");
    await second.stop();
  });

  it("detects connection loss, aborts in-flight work, and blocks every leader capability", async () => {
    const database = new IsolatedAdvisoryDatabase();
    const leader = new LeaderCoordinator(database.factory, "leader", 0);
    await leader.start();
    const signal = leader.signal();
    (database.owner as FakeSession).disconnect();
    await leader.pollNow();
    expect(signal.aborted).toBe(true);
    expect(leader.snapshot().state).toBe("standby");
    for (const capability of [
      "inbound-payment", "target-payment", "registry-publication", "payment-recovery",
      "publication-recovery", "run-execution", "run-recovery", "chain-index",
    ] as const) {
      await expect(leader.assertLeader(capability)).rejects.toBeInstanceOf(NotLeaderError);
    }
    await leader.stop();
  });

  it("never lets a losing process write, pay, publish, recover, execute, or index", async () => {
    const database = new IsolatedAdvisoryDatabase();
    const winner = new LeaderCoordinator(database.factory, "winner", 0);
    const loser = new LeaderCoordinator(database.factory, "loser", 0);
    await Promise.all([winner.start(), loser.start()]);
    const capabilities = [
      "inbound-payment", "target-payment", "registry-publication", "payment-recovery",
      "publication-recovery", "run-execution", "run-recovery", "chain-index",
    ] as const;
    let losingActions = 0;
    const results = await Promise.allSettled(capabilities.map(async (capability) => {
      await loser.assertLeader(capability);
      losingActions += 1;
    }));
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(losingActions).toBe(0);
    await expect(winner.assertLeader("registry-publication")).resolves.toBe("1");
    await Promise.all([winner.stop(), loser.stop()]);
  });
});
