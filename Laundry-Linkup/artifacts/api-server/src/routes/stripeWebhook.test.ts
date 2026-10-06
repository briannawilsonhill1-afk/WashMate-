import type { Express } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  event: null as any,
  storage: {
    findPendingPayoutByStripePayoutId: vi.fn(),
    getPayout: vi.fn(),
    attachStripePayoutId: vi.fn(),
    markPayoutPaid: vi.fn(),
    markPayoutFailed: vi.fn(),
  },
}));

vi.mock("../stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    webhooks: { constructEvent: vi.fn(() => mocks.event) },
  })),
}));
vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("../incidents", () => ({ reconcileIncidentPayout: vi.fn(async () => false) }));
vi.mock("../payoutService", () => ({
  WASHER_PAYOUT_FAILURE_REASON: "Payout could not be sent to your bank. Please try again.",
}));
vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { mountStripeWebhook } from "./stripeWebhook";

function handler() {
  let routeHandlers: any[] = [];
  const app = {
    post: (_path: string, ...handlers: any[]) => { routeHandlers = handlers; },
  } as unknown as Express;
  mountStripeWebhook(app);
  return routeHandlers.at(-1);
}

async function deliver(event: any) {
  mocks.event = event;
  const result: { status: number; body?: any } = { status: 200 };
  const res = {
    status(code: number) { result.status = code; return this; },
    json(body: any) { result.body = body; return this; },
  };
  await handler()(
    { body: Buffer.from("{}"), headers: { "stripe-signature": "valid" } },
    res,
  );
  return result;
}

describe("Stripe washer payout reconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = "test-secret";
    mocks.storage.findPendingPayoutByStripePayoutId.mockResolvedValue(undefined);
    mocks.storage.attachStripePayoutId.mockResolvedValue(true);
    mocks.storage.markPayoutPaid.mockResolvedValue({});
  });

  it("never chooses one of several pending payouts from the Connect account alone", async () => {
    const response = await deliver({
      type: "payout.paid",
      account: "acct_shared",
      data: { object: { id: "po_automatic", metadata: {} } },
    });

    expect(response.status).toBe(200);
    expect(mocks.storage.getPayout).not.toHaveBeenCalled();
    expect(mocks.storage.markPayoutPaid).not.toHaveBeenCalled();
  });

  it("accepts exact metadata only when the Connect account also matches", async () => {
    mocks.storage.getPayout.mockResolvedValue({
      id: 41,
      status: "pending",
      stripePayoutId: null,
      stripeConnectAccountId: "acct_expected",
    });

    await deliver({
      type: "payout.paid",
      account: "acct_other",
      data: { object: { id: "po_wrong", metadata: { washmatePayoutId: "41" } } },
    });
    expect(mocks.storage.markPayoutPaid).not.toHaveBeenCalled();

    await deliver({
      type: "payout.paid",
      account: "acct_expected",
      data: { object: { id: "po_right", metadata: { washmatePayoutId: "41" } } },
    });
    expect(mocks.storage.attachStripePayoutId).toHaveBeenCalledWith(41, "po_right");
    expect(mocks.storage.markPayoutPaid).toHaveBeenCalledWith(41, "po_right");
  });

  it("ignores out-of-order events that name a different Stripe payout", async () => {
    mocks.storage.getPayout.mockResolvedValue({
      id: 42,
      status: "pending",
      stripePayoutId: "po_recorded",
      stripeConnectAccountId: "acct_expected",
    });

    await deliver({
      type: "payout.failed",
      account: "acct_expected",
      data: { object: { id: "po_stale", metadata: { washmatePayoutId: "42" } } },
    });

    expect(mocks.storage.markPayoutFailed).not.toHaveBeenCalled();
  });

  it("treats a duplicate terminal event as already reconciled", async () => {
    await deliver({
      type: "payout.paid",
      account: "acct_expected",
      data: { object: { id: "po_done", metadata: { washmatePayoutId: "43" } } },
    });

    expect(mocks.storage.markPayoutPaid).not.toHaveBeenCalled();
  });
});