import { describe, expect, it } from "vitest";
import { ActiveUserTracker, type ActiveUserStore } from "./activeUsers";

class MemoryActiveUserStore implements ActiveUserStore {
  readonly lastSeen = new Map<string, Date>();

  async record(identifierHash: string, seenAt: Date) {
    const existing = this.lastSeen.get(identifierHash);
    if (!existing || seenAt > existing) {
      this.lastSeen.set(identifierHash, seenAt);
    }
  }

  async deleteBefore(cutoff: Date) {
    for (const [identifier, seenAt] of this.lastSeen) {
      if (seenAt < cutoff) this.lastSeen.delete(identifier);
    }
  }

  async countSince(cutoff: Date) {
    return [...this.lastSeen.values()].filter(seenAt => seenAt >= cutoff).length;
  }
}

describe("ActiveUserTracker", () => {
  it("counts each identifier once within the active window", async () => {
    const store = new MemoryActiveUserStore();
    let now = new Date(1_000);
    const tracker = new ActiveUserTracker(store, () => now);
    await tracker.record("user:one");
    now = new Date(2_000);
    await tracker.record("user:one");
    await tracker.record("ip:127.0.0.1");

    now = new Date(3_000);
    await expect(tracker.count(15)).resolves.toBe(2);
    expect([...store.lastSeen.keys()]).not.toContain("user:one");
  });

  it("removes identifiers outside the active window", async () => {
    const store = new MemoryActiveUserStore();
    let now = new Date(1_000);
    const tracker = new ActiveUserTracker(store, () => now);
    await tracker.record("user:stale");
    now = new Date(10 * 60 * 1_000);
    await tracker.record("user:active");

    now = new Date(16 * 60 * 1_000);
    await expect(tracker.count(15)).resolves.toBe(1);
    await expect(tracker.count(15)).resolves.toBe(1);
  });

  it("does not let a delayed older write replace newer activity", async () => {
    const store = new MemoryActiveUserStore();
    const newerTracker = new ActiveUserTracker(
      store,
      () => new Date(20 * 60 * 1_000),
    );
    const delayedOlderTracker = new ActiveUserTracker(
      store,
      () => new Date(10 * 60 * 1_000),
    );

    await newerTracker.record("user:shared");
    await delayedOlderTracker.record("user:shared");

    const counter = new ActiveUserTracker(
      store,
      () => new Date(26 * 60 * 1_000),
    );
    await expect(counter.count(15)).resolves.toBe(1);
    expect([...store.lastSeen.values()]).toEqual([
      new Date(20 * 60 * 1_000),
    ]);
  });
});