import { db } from "./db";
import { orders, washerProfiles, washerBgCheckEvents, users, payouts, incidentFeeAllocations, PLATFORM_FEE_BPS } from "@workspace/db";
import { allocateFees } from "./incidentPolicy";
import type { Order, InsertOrder, WasherProfile, InsertWasherProfile, User, Payout } from "@workspace/db";
import { eq, and, isNull, inArray, sql, desc } from "drizzle-orm";
import { encryptField, decryptField, isEncrypted } from "./encryption";
import type { CustomerUnlockRepository, UnlockUser } from "./customerUnlock";

export interface EarningsSummary {
  unpaidEarningsCents: number;
  unpaidPlatformFeeCents: number;
  unpaidOrderCount: number;
  unpaidOrderIds: number[];
  payouts: Payout[];
}

export type WasherBgCheckDecision = 'cleared' | 'flagged' | 'provider_failed';
export type WasherBgCheckEvent = {
  id: number;
  washerId: string;
  fromStatus: WasherProfile['bgCheckStatus'] | null;
  toStatus: WasherProfile['bgCheckStatus'];
  actorType: 'washer' | 'operator' | 'provider' | 'system';
  actorId: string | null;
  providerReference: string | null;
  reasonCode: string;
  createdAt: Date;
};

function encryptStr<T extends string | null | undefined>(value: T): T {
  if (value == null || value === "") return value;
  return encryptField(value as string) as T;
}

function decryptStr<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return (isEncrypted(value as string) ? decryptField(value as string) : value) as T;
}

function encryptSensitiveFields(profile: InsertWasherProfile & { userId: string }): typeof profile {
  return {
    ...profile,
    legalName: encryptStr(profile.legalName),
    dateOfBirth: encryptStr(profile.dateOfBirth),
    phone: encryptStr(profile.phone),
    taxId: encryptStr(profile.taxId),
    businessName: encryptStr(profile.businessName),
    bankName: encryptStr(profile.bankName),
    accountHolderName: encryptStr(profile.accountHolderName),
    routingNumber: encryptStr(profile.routingNumber),
    accountNumber: encryptStr(profile.accountNumber),
    county: encryptStr(profile.county),
    state: encryptStr(profile.state),
  };
}

function decryptSensitiveFields(profile: WasherProfile): WasherProfile {
  return {
    ...profile,
    legalName: decryptStr(profile.legalName),
    dateOfBirth: decryptStr(profile.dateOfBirth),
    phone: decryptStr(profile.phone),
    taxId: decryptStr(profile.taxId),
    businessName: decryptStr(profile.businessName),
    bankName: decryptStr(profile.bankName),
    accountHolderName: decryptStr(profile.accountHolderName),
    routingNumber: decryptStr(profile.routingNumber),
    accountNumber: decryptStr(profile.accountNumber),
    county: decryptStr(profile.county),
    state: decryptStr(profile.state),
  };
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  updateUserProfile(id: string, data: { role: 'customer' | 'washer'; address: string }): Promise<User>;

  getOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  createOrder(order: InsertOrder & { customerId: string; flatFee: number; pickupFee: number; soiledFee: number; totalFee: number; pickupAddress: string }): Promise<Order>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  claimOrder(id: number, washerId: string): Promise<Order>;

  getWasherProfile(userId: string): Promise<WasherProfile | undefined>;
  getWasherBgCheckStatus(userId: string): Promise<{ bgCheckStatus: WasherProfile['bgCheckStatus'] } | undefined>;
  upsertWasherProfile(profile: InsertWasherProfile & { userId: string }): Promise<WasherProfile>;
  transitionWasherBgCheck(userId: string, input: {
    toStatus: WasherBgCheckDecision;
    actorId: string;
    providerReference?: string | null;
    reasonCode: string;
  }): Promise<WasherProfile>;
  resubmitWasherBgCheck(userId: string, actorId: string): Promise<WasherProfile>;
  getWasherBgCheckEvents(userId: string): Promise<WasherBgCheckEvent[]>;
  setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void>;
  attachStripeBankAccount(userId: string, data: {
    stripeBankAccountId: string;
    verifiedBankName: string | null;
    verifiedAccountLast4: string | null;
  }): Promise<WasherProfile>;
  clearStripeBankAccount(stripeBankAccountId: string): Promise<number>;
  setStripeConnectAccountId(userId: string, stripeConnectAccountId: string, stripeConnectBankAccountId: string): Promise<void>;

  getWasherEarnings(washerId: string): Promise<EarningsSummary>;
  requestPayout(washerId: string): Promise<Payout>;
  getPayout(payoutId: number): Promise<Payout | undefined>;
  setPayoutStripeIds(payoutId: number, ids: { stripeConnectAccountId: string; stripeTransferId: string; stripePayoutId: string | null }): Promise<void>;
  markPayoutPaid(payoutId: number, stripePayoutId: string | null): Promise<Payout>;
  markPayoutFailed(payoutId: number, reason: string): Promise<Payout>;
  findPendingPayoutByStripePayoutId(stripePayoutId: string): Promise<Payout | undefined>;
  attachStripePayoutId(payoutId: number, stripePayoutId: string): Promise<boolean>;
  listWasherIdsWithUnpaidEarnings(): Promise<string[]>;
}

export class DatabaseStorage implements IStorage, CustomerUnlockRepository {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async get(id: string): Promise<UnlockUser | undefined> {
    return this.getUser(id);
  }

  async withLock<T>(
    userId: string,
    callback: (
      user: UnlockUser,
      update: (values: Partial<Pick<
        UnlockUser,
        "customerStripeCustomerId" | "customerUnlockPaymentIntentId" | "customerUnlockedAt"
      >>) => Promise<UnlockUser>,
    ) => Promise<T>,
  ): Promise<T> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`);
      const [user] = await tx.select().from(users).where(eq(users.id, userId));
      if (!user) throw new Error("USER_NOT_FOUND");

      const update = async (
        values: Partial<Pick<
          UnlockUser,
          "customerStripeCustomerId" | "customerUnlockPaymentIntentId" | "customerUnlockedAt"
        >>,
      ): Promise<UnlockUser> => {
        const [updated] = await tx
          .update(users)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(users.id, userId))
          .returning();
        if (!updated) throw new Error("USER_NOT_FOUND");
        return updated;
      };

      return callback(user, update);
    });
  }

  async markUnlocked(userId: string, paymentIntentId: string): Promise<boolean> {
    const updated = await db
      .update(users)
      .set({ customerUnlockedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(users.id, userId),
        eq(users.customerUnlockPaymentIntentId, paymentIntentId),
        isNull(users.customerUnlockedAt),
      ))
      .returning({ id: users.id });
    if (updated.length > 0) return true;

    const [user] = await db
      .select({
        paymentIntentId: users.customerUnlockPaymentIntentId,
        unlockedAt: users.customerUnlockedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    return (
      user?.paymentIntentId === paymentIntentId &&
      user.unlockedAt !== null
    );
  }

  async updateUserProfile(id: string, data: { role: 'customer' | 'washer'; address: string }): Promise<User> {
    if (data.role === 'customer') {
      return await db.transaction(async (tx) => {
        // Lock the user row to serialize concurrent role-switch requests
        await tx.execute(sql`SELECT id FROM users WHERE id = ${id} FOR UPDATE`);

        // Within the same transaction, check for active orders so the check and
        // update are atomic — preventing a race where a claim commits between the
        // check and the UPDATE in application code.
        const activeOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.washerId, id), inArray(orders.status, ['accepted', 'picked_up', 'in_progress', 'out_for_delivery'])));

        if (activeOrders.length > 0) {
          throw new Error('HAS_ACTIVE_ORDERS');
        }

        const [user] = await tx
          .update(users)
          .set({ role: data.role, address: data.address, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();
        return user;
      });
    }

    const [user] = await db.update(users)
      .set({ role: data.role, address: data.address, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getOrders(): Promise<Order[]> {
    return await db.select().from(orders);
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async createOrder(insertOrder: InsertOrder & { customerId: string; flatFee: number; pickupFee: number; soiledFee: number; totalFee: number; pickupAddress: string }): Promise<Order> {
    const [order] = await db.insert(orders).values(insertOrder).returning();
    return order;
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const validStatus = status as 'pending' | 'accepted' | 'picked_up' | 'in_progress' | 'out_for_delivery' | 'completed';
    const updateData: Partial<typeof orders.$inferInsert> = { status: validStatus };
    if (validStatus === 'completed') {
      updateData.pickupAddress = null;
    }
    const [order] = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
    return order;
  }

  async claimOrder(id: number, washerId: string): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Lock the washer's user row — the same row the role-switch transaction
      // locks. This serializes concurrent claim and role-downgrade requests so
      // neither can succeed after the other has already committed a conflicting
      // state change.
      const lockResult = await tx.execute(
        sql`SELECT id, role FROM users WHERE id = ${washerId} FOR UPDATE`
      );
      const washerUser = (lockResult.rows[0] ?? null) as { id: string; role: string } | null;

      if (!washerUser || washerUser.role !== 'washer') {
        throw new Error('WASHER_ROLE_LOST');
      }
      const approved = await tx.execute(sql`SELECT count(*)::integer AS count FROM incidents WHERE washer_id = ${washerId} AND status = 'approved'`);
      if (Number(approved.rows[0]?.count) >= 3) throw new Error('INCIDENT_WORK_BLOCKED');

      // Re-verify background-check clearance inside the transaction
      const [profile] = await tx
        .select({ bgCheckStatus: washerProfiles.bgCheckStatus })
        .from(washerProfiles)
        .where(eq(washerProfiles.userId, washerId));

      if (!profile || profile.bgCheckStatus !== 'cleared') {
        throw new Error('WASHER_NOT_CLEARED');
      }

      const [order] = await tx
        .update(orders)
        .set({ washerId, status: 'accepted' })
        .where(and(eq(orders.id, id), eq(orders.status, 'pending'), isNull(orders.washerId)))
        .returning();

      if (!order) {
        throw new Error('ORDER_ALREADY_CLAIMED');
      }
      return order;
    });
  }

  async getWasherProfile(userId: string): Promise<WasherProfile | undefined> {
    const [profile] = await db.select().from(washerProfiles).where(eq(washerProfiles.userId, userId));
    if (!profile) return undefined;
    return decryptSensitiveFields(profile);
  }

  async getWasherBgCheckStatus(userId: string): Promise<{ bgCheckStatus: WasherProfile['bgCheckStatus'] } | undefined> {
    const [row] = await db
      .select({ bgCheckStatus: washerProfiles.bgCheckStatus })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, userId));
    return row;
  }

  async transitionWasherBgCheck(userId: string, input: {
    toStatus: WasherBgCheckDecision;
    actorId: string;
    providerReference?: string | null;
    reasonCode: string;
  }): Promise<WasherProfile> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM washer_profiles WHERE user_id = ${userId} FOR UPDATE`);
      const [profile] = await tx.select().from(washerProfiles).where(eq(washerProfiles.userId, userId));
      if (!profile) throw new Error('WASHER_PROFILE_NOT_FOUND');
      if (profile.bgCheckStatus !== 'pending') throw new Error('BG_CHECK_NOT_PENDING');
      if (!profile.bgCheckConsent || !profile.bgSelfCertify || !profile.county || !profile.state) {
        throw new Error('BG_CHECK_CONSENT_REQUIRED');
      }

      const [updated] = await tx
        .update(washerProfiles)
        .set({ bgCheckStatus: input.toStatus, bgCheckDate: new Date(), updatedAt: new Date() })
        .where(eq(washerProfiles.userId, userId))
        .returning();
      if (!updated) throw new Error('WASHER_PROFILE_NOT_FOUND');

      await tx.insert(washerBgCheckEvents).values({
        washerId: userId,
        fromStatus: profile.bgCheckStatus,
        toStatus: input.toStatus,
        actorType: 'operator',
        actorId: input.actorId,
        providerReference: input.providerReference ?? null,
        reasonCode: input.reasonCode,
      });
      return decryptSensitiveFields(updated);
    });
  }

  async resubmitWasherBgCheck(userId: string, actorId: string): Promise<WasherProfile> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM washer_profiles WHERE user_id = ${userId} FOR UPDATE`);
      const [profile] = await tx.select().from(washerProfiles).where(eq(washerProfiles.userId, userId));
      if (!profile) throw new Error('WASHER_PROFILE_NOT_FOUND');
      if (!['flagged', 'provider_failed'].includes(profile.bgCheckStatus)) {
        throw new Error('BG_CHECK_NOT_RESUBMITTABLE');
      }
      if (!profile.bgCheckConsent || !profile.bgSelfCertify || !profile.county || !profile.state) {
        throw new Error('BG_CHECK_CONSENT_REQUIRED');
      }

      const [updated] = await tx
        .update(washerProfiles)
        .set({ bgCheckStatus: 'pending', bgCheckDate: new Date(), updatedAt: new Date() })
        .where(eq(washerProfiles.userId, userId))
        .returning();
      if (!updated) throw new Error('WASHER_PROFILE_NOT_FOUND');

      await tx.insert(washerBgCheckEvents).values({
        washerId: userId,
        fromStatus: profile.bgCheckStatus,
        toStatus: 'pending',
        actorType: 'operator',
        actorId,
        providerReference: null,
        reasonCode: 'resubmitted',
      });
      return decryptSensitiveFields(updated);
    });
  }

  async getWasherBgCheckEvents(userId: string): Promise<WasherBgCheckEvent[]> {
    return db
      .select()
      .from(washerBgCheckEvents)
      .where(eq(washerBgCheckEvents.washerId, userId))
      .orderBy(desc(washerBgCheckEvents.createdAt), desc(washerBgCheckEvents.id));
  }

  async setStripeCustomerId(userId: string, stripeCustomerId: string): Promise<void> {
    await db
      .update(washerProfiles)
      .set({ stripeCustomerId, updatedAt: new Date() })
      .where(eq(washerProfiles.userId, userId));
  }

  async attachStripeBankAccount(userId: string, data: {
    stripeBankAccountId: string;
    verifiedBankName: string | null;
    verifiedAccountLast4: string | null;
  }): Promise<WasherProfile> {
    const [updated] = await db
      .update(washerProfiles)
      .set({
        stripeBankAccountId: data.stripeBankAccountId,
        verifiedBankName: data.verifiedBankName,
        verifiedAccountLast4: data.verifiedAccountLast4,
        stripeVerifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(washerProfiles.userId, userId))
      .returning();
    if (!updated) throw new Error("WASHER_PROFILE_NOT_FOUND");
    return decryptSensitiveFields(updated);
  }

  async clearStripeBankAccount(stripeBankAccountId: string): Promise<number> {
    const cleared = await db
      .update(washerProfiles)
      .set({
        stripeBankAccountId: null,
        verifiedBankName: null,
        verifiedAccountLast4: null,
        stripeVerifiedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(washerProfiles.stripeBankAccountId, stripeBankAccountId))
      .returning({ userId: washerProfiles.userId });
    return cleared.length;
  }

  // Compute the washer's unpaid earnings by summing every completed order
  // where they are the assigned washer and no payout has been recorded yet.
  // Pending/failed payouts already lock their associated orders via orders.payoutId,
  // so they're correctly excluded from "unpaid" here.
  async getWasherEarnings(washerId: string): Promise<EarningsSummary> {
    const unpaidRows = await db
      .select({ id: orders.id, totalFee: orders.totalFee })
      .from(orders)
      .where(and(eq(orders.washerId, washerId), eq(orders.status, 'completed'), isNull(orders.payoutId)));

    let totalCents = 0;
    const unpaidOrderIds: number[] = [];
    for (const row of unpaidRows) {
      totalCents += row.totalFee * 100;
      unpaidOrderIds.push(row.id);
    }
    const platformFeeCents = Math.floor((totalCents * PLATFORM_FEE_BPS) / 10_000);
    const unpaidEarningsCents = totalCents - platformFeeCents;

    const payoutRows = await db
      .select()
      .from(payouts)
      .where(eq(payouts.washerId, washerId))
      .orderBy(desc(payouts.createdAt))
      .limit(50);

    return {
      unpaidEarningsCents,
      unpaidPlatformFeeCents: platformFeeCents,
      unpaidOrderCount: unpaidRows.length,
      unpaidOrderIds,
      payouts: payoutRows,
    };
  }

  // Atomically roll all unpaid completed orders into a new payout. The
  // transaction locks the washer's user row (same pattern as claimOrder /
  // updateUserProfile) so concurrent payout requests can't double-pay the
  // same orders. The payout is created in `pending` status — actual money
  // movement to the washer's bank requires Stripe Connect onboarding, which
  // is tracked in a follow-up task. Until then a payout stays pending until
  // ops reconciles it via markPayoutPaid().
  async requestPayout(washerId: string): Promise<Payout> {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${washerId} FOR UPDATE`);

      const [profile] = await tx.select().from(washerProfiles).where(eq(washerProfiles.userId, washerId));
      if (!profile) throw new Error('WASHER_PROFILE_NOT_FOUND');
      if (!profile.stripeBankAccountId) throw new Error('NO_VERIFIED_BANK');

      const unpaidRows = await tx
        .select({ id: orders.id, totalFee: orders.totalFee })
        .from(orders)
        .where(and(eq(orders.washerId, washerId), eq(orders.status, 'completed'), isNull(orders.payoutId)));

      if (unpaidRows.length === 0) throw new Error('NO_UNPAID_EARNINGS');

      let totalCents = 0;
      for (const row of unpaidRows) totalCents += row.totalFee * 100;
      const platformFeeCents = Math.floor((totalCents * PLATFORM_FEE_BPS) / 10_000);
      const debt = await tx.execute(sql`
        SELECT f.id, (f.amount_cents - COALESCE(SUM(a.amount_cents) FILTER (WHERE p.status IN ('pending','paid')), 0))::integer AS remaining
        FROM incident_fees f LEFT JOIN incident_fee_allocations a ON a.fee_id = f.id
        LEFT JOIN payouts p ON p.id = a.payout_id
        WHERE f.washer_id = ${washerId} GROUP BY f.id ORDER BY f.id`);
      const { amountCents, incidentFeeCents, allocations } = allocateFees(
        totalCents - platformFeeCents,
        debt.rows as {id: number; remaining: number}[],
      );

      const [payout] = await tx
        .insert(payouts)
        .values({
          washerId,
          totalFeeCents: totalCents,
          platformFeeCents,
          amountCents,
          incidentFeeCents,
          orderCount: unpaidRows.length,
          status: 'pending',
          stripeBankAccountId: profile.stripeBankAccountId,
          verifiedBankName: profile.verifiedBankName,
          verifiedAccountLast4: profile.verifiedAccountLast4,
        })
        .returning();

      if (allocations.length) await tx.insert(incidentFeeAllocations).values(
        allocations.map(a => ({ ...a, payoutId: payout.id })),
      );
      // Stamp every included order with the new payout id so a concurrent
      // request can't pull them into a second payout. We re-assert the
      // payoutId IS NULL guard so a phantom row update can never reassign an
      // already-paid order, and we verify the row count matches what we
      // selected — if not, something changed under us and we abort.
      const stamped = await tx
        .update(orders)
        .set({ payoutId: payout.id })
        .where(and(
          eq(orders.washerId, washerId),
          inArray(orders.id, unpaidRows.map(r => r.id)),
          isNull(orders.payoutId),
        ))
        .returning({ id: orders.id });

      if (stamped.length !== unpaidRows.length) {
        throw new Error('PAYOUT_RACE_DETECTED');
      }

      return payout;
    });
  }

  async setStripeConnectAccountId(userId: string, stripeConnectAccountId: string, stripeConnectBankAccountId: string): Promise<void> {
    await db.update(washerProfiles)
      .set({ stripeConnectAccountId, stripeConnectBankAccountId, updatedAt: new Date() })
      .where(eq(washerProfiles.userId, userId));
  }

  async getPayout(payoutId: number): Promise<Payout | undefined> {
    const [row] = await db.select().from(payouts).where(eq(payouts.id, payoutId));
    return row;
  }

  async setPayoutStripeIds(payoutId: number, ids: { stripeConnectAccountId: string; stripeTransferId: string; stripePayoutId: string | null }): Promise<void> {
    await db.update(payouts)
      .set({ stripeConnectAccountId: ids.stripeConnectAccountId, stripeTransferId: ids.stripeTransferId, stripePayoutId: ids.stripePayoutId })
      .where(eq(payouts.id, payoutId));
  }

  async findPendingPayoutByStripePayoutId(stripePayoutId: string): Promise<Payout | undefined> {
    const [row] = await db.select().from(payouts).where(and(eq(payouts.stripePayoutId, stripePayoutId), eq(payouts.status, 'pending')));
    return row;
  }

  async attachStripePayoutId(payoutId: number, stripePayoutId: string): Promise<boolean> {
    let rows: { id: number }[];
    try {
      rows = await db.update(payouts).set({ stripePayoutId }).where(and(
        eq(payouts.id, payoutId),
        eq(payouts.status, 'pending'),
        isNull(payouts.stripePayoutId),
      )).returning({ id: payouts.id });
    } catch (err: any) {
      // Another local payout already claimed this Stripe payout id.
      if (err?.code === "23505" || err?.cause?.code === "23505") return false;
      throw err;
    }
    if (rows.length > 0) return true;
    const existing = await this.getPayout(payoutId);
    return existing?.stripePayoutId === stripePayoutId;
  }

  async listWasherIdsWithUnpaidEarnings(): Promise<string[]> {
    const rows = await db
      .selectDistinct({ washerId: orders.washerId })
      .from(orders)
      .where(and(eq(orders.status, 'completed'), isNull(orders.payoutId)));
    return rows.map(r => r.washerId).filter((id): id is string => !!id);
  }

  // Lifecycle transitions are constrained to start from `pending` so that a
  // misuse of these admin/reconciliation entrypoints can never re-open an
  // already-settled payout (which would otherwise let the orders inside it be
  // double-paid). Both methods are no-ops on a non-pending payout.
  async markPayoutPaid(payoutId: number, stripePayoutId: string | null): Promise<Payout> {
    const [updated] = await db
      .update(payouts)
      .set({ status: 'paid', stripePayoutId, paidAt: new Date(), failureReason: null })
      .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'pending')))
      .returning();
    if (!updated) {
      const existing = await this.getPayout(payoutId);
      if (existing?.status === 'paid' && existing.stripePayoutId === stripePayoutId) return existing;
      throw new Error('PAYOUT_NOT_PENDING');
    }
    return updated;
  }

  async markPayoutFailed(payoutId: number, reason: string): Promise<Payout> {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(payouts).where(eq(payouts.id, payoutId));
      if (!existing) throw new Error('PAYOUT_NOT_FOUND');
      await tx.execute(sql`SELECT id FROM users WHERE id = ${existing.washerId} FOR UPDATE`);
      // A bank payout failure returns money to the Connect balance, not the
      // platform. Releasing orders/debt after a transfer would double-pay.
      if (existing.stripeTransferId || existing.transferAttemptAt) {
        const [held] = await tx.update(payouts).set({ failureReason: reason })
          .where(eq(payouts.id, payoutId)).returning();
        return held;
      }
      const [updated] = await tx
        .update(payouts)
        .set({ status: 'failed', failureReason: reason })
        .where(and(eq(payouts.id, payoutId), eq(payouts.status, 'pending')))
        .returning();
      if (!updated) throw new Error('PAYOUT_NOT_PENDING');
      // Release the orders so the washer can request a new payout once the
      // root cause (e.g. revoked bank link) is fixed.
      await tx.update(orders).set({ payoutId: null }).where(eq(orders.payoutId, payoutId));
      return updated;
    });
  }

  async upsertWasherProfile(profile: InsertWasherProfile & { userId: string }): Promise<WasherProfile> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM users WHERE id = ${profile.userId} FOR UPDATE`);
      const [existing] = await tx.select().from(washerProfiles).where(eq(washerProfiles.userId, profile.userId));

      // Status and date are omitted from InsertWasherProfile and are exclusively
      // derived here. A washer may submit a new screening only from
      // not_started; provider decisions and resubmissions use operator routes.
      let serverVerification: Partial<typeof washerProfiles.$inferInsert> = {};
      let auditEvent: typeof washerBgCheckEvents.$inferInsert | undefined;
      const completeSubmission = Boolean(profile.bgCheckConsent && profile.bgSelfCertify && profile.county && profile.state);

      if (completeSubmission && (!existing || existing.bgCheckStatus === 'not_started')) {
        serverVerification = { bgCheckStatus: 'pending', bgCheckDate: new Date() };
        auditEvent = {
          washerId: profile.userId,
          fromStatus: existing?.bgCheckStatus ?? null,
          toStatus: 'pending',
          actorType: 'washer',
          actorId: profile.userId,
          providerReference: null,
          reasonCode: 'screening_submitted',
        };
      } else if (
        existing &&
        (!profile.bgCheckConsent || !profile.bgSelfCertify) &&
        existing.bgCheckStatus !== 'not_started'
      ) {
        // Consent/self-certification withdrawal immediately removes eligibility.
        // This is not a provider decision; it is recorded as a user withdrawal.
        serverVerification = { bgCheckStatus: 'not_started', bgCheckDate: null };
        auditEvent = {
          washerId: profile.userId,
          fromStatus: existing.bgCheckStatus,
          toStatus: 'not_started',
          actorType: 'washer',
          actorId: profile.userId,
          providerReference: null,
          reasonCode: !profile.bgCheckConsent ? 'consent_withdrawn' : 'self_certification_withdrawn',
        };
      }

      const encryptedProfile = encryptSensitiveFields(profile);
      const saved = existing
        ? (await tx.update(washerProfiles)
            .set({ ...encryptedProfile, ...serverVerification, updatedAt: new Date() })
            .where(eq(washerProfiles.userId, profile.userId))
            .returning())[0]
        : (await tx.insert(washerProfiles)
            .values({ ...encryptedProfile, ...serverVerification })
            .returning())[0];

      if (auditEvent) await tx.insert(washerBgCheckEvents).values(auditEvent);
      return decryptSensitiveFields(saved);
    });
  }
}

export const storage = new DatabaseStorage();
