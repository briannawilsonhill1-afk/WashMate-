import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { payouts } from "@workspace/db";
import { db, pool } from "./db";
import { DatabaseStorage } from "./storage";

describe.sequential("database-backed payout reconciliation", () => {
  const createdIds: number[] = [];
  const storage = new DatabaseStorage();

  async function pendingPayout() {
    const [row] = await db.insert(payouts).values({
      washerId: `payout-test-${randomUUID()}`,
      totalFeeCents: 1_000,
      platformFeeCents: 200,
      amountCents: 800,
      orderCount: 1,
      status: "pending",
      stripeBankAccountId: `fca_${randomUUID()}`,
      stripeConnectAccountId: "acct_shared_test",
    }).returning();
    createdIds.push(row.id);
    return row;
  }

  afterEach(async () => {
    if (createdIds.length) {
      await db.delete(payouts).where(inArray(payouts.id, createdIds.splice(0)));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("keeps multiple pending rows separate and lets only one claim a Stripe payout", async () => {
    const older = await pendingPayout();
    const newer = await pendingPayout();
    const stripePayoutId = `po_${randomUUID()}`;

    expect(await storage.attachStripePayoutId(older.id, stripePayoutId)).toBe(true);
    expect(await storage.attachStripePayoutId(newer.id, stripePayoutId)).toBe(false);
    expect((await storage.getPayout(older.id))?.stripePayoutId).toBe(stripePayoutId);
    expect((await storage.getPayout(newer.id))?.stripePayoutId).toBeNull();
  });

  it("handles a repeated paid transition idempotently without reopening the row", async () => {
    const payout = await pendingPayout();
    const stripePayoutId = `po_${randomUUID()}`;
    await storage.attachStripePayoutId(payout.id, stripePayoutId);

    const first = await storage.markPayoutPaid(payout.id, stripePayoutId);
    const duplicate = await storage.markPayoutPaid(payout.id, stripePayoutId);

    expect(first.status).toBe("paid");
    expect(duplicate.status).toBe("paid");
    expect(duplicate.stripePayoutId).toBe(stripePayoutId);
  });
});