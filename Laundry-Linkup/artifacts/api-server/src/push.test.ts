import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recipients: [] as { token: string }[],
  innerJoin: vi.fn(),
  where: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("./pushReceipts", () => ({
  PushReceiptQueue: class {
    enqueue = mocks.enqueue;
  },
}));

vi.mock("./db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("./lib/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

import {
  buildNewOrderPushMessages,
  chunkPushMessages,
  EXPO_MAX_MESSAGES_PER_REQUEST,
  notifyClearedWashersOfNewOrder,
} from "./push";

describe("new-order push notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.recipients = [];
    mocks.where.mockImplementation(async () => mocks.recipients);
    mocks.innerJoin.mockReturnValue({
      innerJoin: mocks.innerJoin,
      where: mocks.where,
    });
    mocks.from.mockReturnValue({
      innerJoin: mocks.innerJoin,
    });
    mocks.select.mockReturnValue({
      from: mocks.from,
    });
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    })));
  });

  it("builds the washer-dashboard notification payload", () => {
    expect(buildNewOrderPushMessages(["ExpoPushToken[washer]"], 42)).toEqual([
      {
        to: "ExpoPushToken[washer]",
        sound: "default",
        title: "New laundry job available",
        body: "Open WashMate to view and claim the new job.",
        data: { orderId: 42, type: "new_order" },
      },
    ]);
  });

  it("creates no messages when the eligibility query returns no recipients", () => {
    expect(buildNewOrderPushMessages([], 42)).toEqual([]);
    expect(chunkPushMessages([])).toEqual([]);
  });

  it("keeps every eligible recipient while respecting Expo's batch limit", () => {
    const tokens = Array.from(
      { length: EXPO_MAX_MESSAGES_PER_REQUEST * 2 + 1 },
      (_, index) => `ExpoPushToken[washer-${index}]`,
    );
    const messages = buildNewOrderPushMessages(tokens, 42);
    const batches = chunkPushMessages(messages);

    expect(batches.map((batch) => batch.length)).toEqual([
      EXPO_MAX_MESSAGES_PER_REQUEST,
      EXPO_MAX_MESSAGES_PER_REQUEST,
      1,
    ]);
    expect(batches.flat().map((message) => message.to)).toEqual(tokens);
  });

  it("broadcasts only the tokens returned by the current-role and clearance query", async () => {
    mocks.recipients = [
      { token: "ExpoPushToken[cleared-washer-1]" },
      { token: "ExpoPushToken[cleared-washer-2]" },
    ];

    await notifyClearedWashersOfNewOrder(42);

    expect(mocks.innerJoin).toHaveBeenCalledTimes(2);
    expect(mocks.where).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    const request = vi.mocked(fetch).mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toEqual([
      expect.objectContaining({ to: "ExpoPushToken[cleared-washer-1]" }),
      expect.objectContaining({ to: "ExpoPushToken[cleared-washer-2]" }),
    ]);
  });

  it("does not contact Expo when no currently eligible washer has an iOS token", async () => {
    await notifyClearedWashersOfNewOrder(42);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("queues successful ticket IDs with their original device token", async () => {
    mocks.recipients = [{ token: "token-a" }, { token: "token-b" }, { token: "token-c" }];
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [
        { status: "error", details: { error: "MessageTooBig" } },
        { status: "ok", id: "receipt-b" },
        { status: "ok" },
      ] }),
    })));
    await notifyClearedWashersOfNewOrder(42);
    expect(mocks.enqueue).toHaveBeenCalledExactlyOnceWith("receipt-b", "token-b");
  });
});