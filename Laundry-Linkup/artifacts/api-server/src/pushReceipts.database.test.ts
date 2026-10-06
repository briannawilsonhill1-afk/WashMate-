import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { pushReceiptQueue } from "@workspace/db";
import { db, pool } from "./db";
import { DatabaseReceiptStore, PushReceiptQueue } from "./pushReceipts";
import { logger } from "./lib/logger";

vi.mock("./lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn() },
}));

type RunnableQueue = {
  checkDue(): Promise<void>;
};

describe.sequential("database-backed Expo receipt claims", () => {
  const ticketIds: string[] = [];
  const tokens: string[] = [];

  function uniqueValue(label: string): string {
    return `receipt-test-${label}-${randomUUID()}`;
  }

  async function insertDueReceipt(options?: {
    claimId?: string;
    claimUntil?: Date;
  }) {
    const ticketId = uniqueValue("ticket");
    const token = uniqueValue("token");
    ticketIds.push(ticketId);
    tokens.push(token);
    await db.insert(pushReceiptQueue).values({
      ticketId,
      token,
      dueAt: new Date(Date.now() - 60_000),
      claimId: options?.claimId,
      claimUntil: options?.claimUntil,
    });
    return { ticketId, token };
  }

  function runnableQueue(removeTokens: (tokens: string[]) => Promise<void>) {
    const queue = new PushReceiptQueue(removeTokens, new DatabaseReceiptStore());
    vi.clearAllTimers();
    return queue as unknown as RunnableQueue;
  }

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
    if (ticketIds.length > 0) {
      await db
        .delete(pushReceiptQueue)
        .where(inArray(pushReceiptQueue.ticketId, ticketIds.splice(0)));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("lets only one racing worker check and prune the same due batch", async () => {
    vi.useFakeTimers();
    const first = await insertDueReceipt();
    const second = await insertDueReceipt();
    let releaseProvider!: () => void;
    const providerBlocked = new Promise<void>((resolve) => {
      releaseProvider = resolve;
    });
    const request = vi.fn(async () => {
      await providerBlocked;
      return {
        ok: true,
        json: async () => ({
          data: {
            [first.ticketId]: {
              status: "error",
              details: { error: "DeviceNotRegistered" },
            },
            [second.ticketId]: { status: "ok" },
          },
        }),
      };
    });
    vi.stubGlobal("fetch", request);
    const prune = vi.fn().mockResolvedValue(undefined);
    const workerOne = runnableQueue(prune);
    const workerTwo = runnableQueue(prune);

    const firstRun = workerOne.checkDue();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    const secondRun = workerTwo.checkDue();
    await secondRun;
    releaseProvider();
    await firstRun;

    expect(request).toHaveBeenCalledTimes(1);
    expect(prune).toHaveBeenCalledExactlyOnceWith([first.token]);
    expect(await db
      .select({ ticketId: pushReceiptQueue.ticketId })
      .from(pushReceiptQueue)
      .where(inArray(pushReceiptQueue.ticketId, [first.ticketId, second.ticketId])))
      .toHaveLength(0);
    expect(JSON.stringify(vi.mocked(logger).info.mock.calls)).not.toContain(first.token);
    expect(JSON.stringify(vi.mocked(logger).warn.mock.calls)).not.toContain(first.token);
  });

  it("reclaims an expired lease with its persisted token association intact", async () => {
    vi.useFakeTimers();
    const expiredClaimId = uniqueValue("expired-claim");
    const receipt = await insertDueReceipt({
      claimId: expiredClaimId,
      claimUntil: new Date(Date.now() - 1_000),
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          [receipt.ticketId]: {
            status: "error",
            details: { error: "DeviceNotRegistered" },
          },
        },
      }),
    }));
    const prune = vi.fn().mockResolvedValue(undefined);
    const worker = runnableQueue(prune);

    await worker.checkDue();

    expect(prune).toHaveBeenCalledExactlyOnceWith([receipt.token]);
    expect(await db
      .select({ ticketId: pushReceiptQueue.ticketId })
      .from(pushReceiptQueue)
      .where(and(
        eq(pushReceiptQueue.ticketId, receipt.ticketId),
        eq(pushReceiptQueue.claimId, expiredClaimId),
      )))
      .toHaveLength(0);
    expect(JSON.stringify(vi.mocked(logger).info.mock.calls)).not.toContain(receipt.token);
    expect(JSON.stringify(vi.mocked(logger).warn.mock.calls)).not.toContain(receipt.token);
  });
});