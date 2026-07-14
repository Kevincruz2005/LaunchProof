import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { MemoryRepository } from "../src/db/store.js";
import { RehearsalService } from "../src/workers/rehearsal.js";

describe("atomic run reservation", () => {
  it("returns one run for concurrent requests with the same idempotency key", async () => {
    const repository = new MemoryRepository();
    const service = new RehearsalService(loadConfig({ NODE_ENV: "test" }), repository);
    const reservations = await Promise.all(
      Array.from({ length: 12 }, () => service.reserve("https://fixture.example", "same-request-key")),
    );
    expect(new Set(reservations.map((run) => run.run_id)).size).toBe(1);
    expect(reservations.every((run) => run.state === "payment_required")).toBe(true);
  });
});
