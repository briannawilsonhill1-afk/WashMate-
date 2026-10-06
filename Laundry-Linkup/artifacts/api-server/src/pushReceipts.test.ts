import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PushReceiptQueue, type ReceiptStore } from "./pushReceipts";
import { logger } from "./lib/logger";

vi.mock("./lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));

describe("background Expo receipts", () => {
  const prune = vi.fn();
  const request = vi.fn();
  let entries: Map<string, {
    ticketId: string;
    token: string;
    dueAt: Date;
    attempts: number;
    claimId?: string;
  }>;
  let store: ReceiptStore;
  let queue: PushReceiptQueue;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    prune.mockResolvedValue(undefined);
    request.mockResolvedValue({ ok: true, json: async () => ({ data: {} }) });
    vi.stubGlobal("fetch", request);
    entries = new Map();
    store = {
      enqueue: async (entry) => {
        if (!entries.has(entry.ticketId) && entries.size >= 10_000) return false;
        if (!entries.has(entry.ticketId)) {
          entries.set(entry.ticketId, { ...entry, attempts: 0 });
        }
        return true;
      },
      claimDue: async (now, limit, claimId) => {
        const due = [...entries.values()]
          .filter((entry) => entry.dueAt <= now && entry.claimId === undefined)
          .slice(0, limit);
        for (const entry of due) {
          entry.claimId = claimId;
          entry.attempts++;
        }
        return due.map(({ ticketId, token, attempts }) => ({ ticketId, token, attempts }));
      },
      complete: async (ticketId, claimId) => {
        if (entries.get(ticketId)?.claimId === claimId) entries.delete(ticketId);
      },
      retry: async (ticketId, claimId, dueAt) => {
        const entry = entries.get(ticketId);
        if (entry?.claimId === claimId) {
          entry.claimId = undefined;
          entry.dueAt = dueAt;
        }
      },
      expire: async (ticketId, claimId) => {
        if (entries.get(ticketId)?.claimId === claimId) entries.delete(ticketId);
      },
      hasPending: async () => entries.size > 0,
    };
    queue = new PushReceiptQueue(prune, store);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("does not await receipts and prunes only the matching uninstalled device", async () => {
    request.mockResolvedValue({ ok: true, json: async () => ({ data: {
      stale: { status: "error", details: { error: "DeviceNotRegistered" } },
      healthy: { status: "ok" },
      other: { status: "error", details: { error: "MessageTooBig" } },
    } }) });
    queue.enqueue("stale", "token-a");
    queue.enqueue("healthy", "token-b");
    queue.enqueue("other", "token-c");
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(request).toHaveBeenCalledWith(
      "https://exp.host/--/api/v2/push/getReceipts",
      expect.objectContaining({ body: JSON.stringify({ ids: ["stale", "healthy", "other"] }), signal: expect.any(AbortSignal) }),
    );
    expect(prune).toHaveBeenCalledExactlyOnceWith(["token-a"]);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["missing", "network", "http", "malformed"])("bounds retries for %s receipts", async (failure) => {
    if (failure === "network") request.mockRejectedValue(new Error("offline"));
    if (failure === "http") request.mockResolvedValue({ ok: false });
    if (failure === "malformed") request.mockResolvedValue({ ok: true, json: async () => ({}) });
    queue.enqueue("id", "token");
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(request).toHaveBeenCalledTimes(3);
    expect(prune).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 1,
        event: "push_receipt_retries_exhausted",
        failureCategory: failure === "network" || failure === "http"
          ? "provider"
          : "malformed_response",
      }),
      "Expo receipt checks exhausted",
    );
  });

  it.each(["retry", "expire"] as const)("surfaces %s persistence failures as database failures", async (operation) => {
    queue.enqueue("id", "secret-device-token");
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    const entry = entries.get("id")!;
    entry.attempts = operation === "expire" ? 2 : 0;
    store[operation] = vi.fn().mockRejectedValue(new Error("db unavailable"));

    await vi.advanceTimersByTimeAsync(5 * 60_000);

    expect(vi.mocked(logger).warn).toHaveBeenCalledWith(
      {
        count: 1,
        event: "push_receipt_persistence_failed",
        failureCategory: "database",
        operation,
      },
      "Expo receipt persistence failed",
    );
    expect(JSON.stringify(vi.mocked(logger).warn.mock.calls)).not.toContain(
      "secret-device-token",
    );
  });

  it("retries missing receipts and failed token deletion", async () => {
    queue.enqueue("id", "token");
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    request.mockResolvedValue({ ok: true, json: async () => ({ data: {
      id: { status: "error", details: { error: "DeviceNotRegistered" } },
    } }) });
    prune.mockRejectedValueOnce(new Error("db unavailable"));
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(prune).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("recovers a persisted receipt when a new worker starts", async () => {
    queue.enqueue("id", "token");
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(request).toHaveBeenCalledTimes(1);
    console.log("before restart", new Date(), [...entries.values()], vi.getTimerCount());
    expect(entries.get("id")).toMatchObject({ attempts: 1, claimId: undefined });

    // Simulate the original process disappearing before its next retry tick.
    vi.clearAllTimers();
    const restartedQueue = new PushReceiptQueue(prune, store);
    request.mockResolvedValue({ ok: true, json: async () => ({ data: {
      id: { status: "error", details: { error: "DeviceNotRegistered" } },
    } }) });
    vi.setSystemTime(new Date(entries.get("id")!.dueAt.getTime() + 1_000));
    await vi.advanceTimersByTimeAsync(60_000);

    expect(restartedQueue).toBeInstanceOf(PushReceiptQueue);
    expect(prune).toHaveBeenCalledExactlyOnceWith(["token"]);
    expect(entries).toHaveLength(0);
  });

  it("caps queue size and receipt request batches", async () => {
    for (let i = 0; i < 10_001; i++) queue.enqueue(String(i), `token-${i}`);
    await vi.advanceTimersByTimeAsync(15 * 60_000);
    expect(request).toHaveBeenCalledTimes(10);
    const ids = request.mock.calls.flatMap(([, init]) => JSON.parse(init.body).ids);
    expect(ids).toHaveLength(10_000);
    expect(ids).not.toContain("10000");
    expect(request.mock.calls.every(([, init]) => JSON.parse(init.body).ids.length <= 1_000)).toBe(true);
  });
});