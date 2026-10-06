import type { Express } from "express";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { revenueDashboardSnapshots } from "@workspace/db";
import { getUserId, isAuthenticated } from "./auth";
import { db, pool } from "./db";
import { isIncidentAdmin } from "./incidentPolicy";
import { logger } from "./lib/logger";
import { getUncachableStripeClient } from "./stripeClient";

const CENTRAL_TIME_ZONE = "America/Chicago";
const MONTH_COUNT = 12;
const REFRESH_CHECK_MS = 60_000;
const SNAPSHOT_KEY = "stripe-revenue";
const REFRESH_LOCK_KEY = "washmate:stripe-revenue-dashboard";

export type SubscriptionLike = {
  id: string;
  created: number;
  canceled_at: number | null;
  ended_at: number | null;
  status: string;
  customer: string | {
    id: string;
    name?: string | null;
    email?: string | null;
    deleted?: boolean;
  };
  items: {
    data: Array<{
      quantity?: number | null;
      price: {
        unit_amount?: number | null;
        recurring?: {
          interval: "day" | "week" | "month" | "year";
          interval_count: number;
        } | null;
      };
    }>;
  };
};

export type RevenueDashboard = {
  currency: "usd";
  refreshedAt: string;
  refreshSchedule: string;
  currentMrrCents: number;
  monthly: Array<{
    month: string;
    label: string;
    mrrCents: number;
    newMrrCents: number;
    churnedMrrCents: number;
  }>;
  topCustomers: Array<{
    id: string;
    name: string;
    email: string | null;
    mrrCents: number;
  }>;
};

let refreshPromise: Promise<RevenueDashboard> | null = null;
let schedulerStarted = false;

function centralDateParts(date: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CENTRAL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    hour: Number(value("hour")),
  };
}

function refreshBoundary(date: Date): string {
  const central = centralDateParts(date);
  if (central.hour >= 7) return central.date;
  // Twelve hours earlier is safely on the previous Central calendar day,
  // including daylight-saving transitions.
  return centralDateParts(new Date(date.getTime() - 12 * 60 * 60 * 1000)).date;
}

function monthlyAmountCents(subscription: SubscriptionLike): number {
  return subscription.items.data.reduce((total, item) => {
    const amount = item.price.unit_amount ?? 0;
    const quantity = item.quantity ?? 1;
    const recurring = item.price.recurring;
    if (!recurring || amount <= 0 || quantity <= 0) return total;
    const count = recurring.interval_count || 1;
    const monthly = recurring.interval === "year"
      ? amount / (12 * count)
      : recurring.interval === "week"
        ? amount * (52 / 12) / count
        : recurring.interval === "day"
          ? amount * (365 / 12) / count
          : amount / count;
    return total + monthly * quantity;
  }, 0);
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function addMonths(date: Date, count: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + count, 1));
}

function customerDetails(subscription: SubscriptionLike) {
  if (typeof subscription.customer === "string") {
    return { id: subscription.customer, name: "Stripe customer", email: null };
  }
  return {
    id: subscription.customer.id,
    name: subscription.customer.deleted
      ? "Deleted Stripe customer"
      : subscription.customer.name || subscription.customer.email || "Stripe customer",
    email: subscription.customer.deleted ? null : subscription.customer.email ?? null,
  };
}

export function calculateRevenueDashboard(
  subscriptions: SubscriptionLike[],
  now = new Date(),
): RevenueDashboard {
  const firstMonth = addMonths(monthStart(now), -(MONTH_COUNT - 1));
  const eligible = subscriptions.filter(subscription =>
    !["incomplete", "incomplete_expired"].includes(subscription.status)
  );

  const monthly = Array.from({ length: MONTH_COUNT }, (_, index) => {
    const start = addMonths(firstMonth, index);
    const end = addMonths(start, 1);
    const startSeconds = start.getTime() / 1000;
    const endSeconds = end.getTime() / 1000;
    let mrrCents = 0;
    let newMrrCents = 0;
    let churnedMrrCents = 0;

    for (const subscription of eligible) {
      const mrr = monthlyAmountCents(subscription);
      const endedAt = subscription.ended_at ?? subscription.canceled_at;
      if (subscription.created < endSeconds && (!endedAt || endedAt >= endSeconds)) {
        mrrCents += mrr;
      }
      if (subscription.created >= startSeconds && subscription.created < endSeconds) {
        newMrrCents += mrr;
      }
      if (endedAt && endedAt >= startSeconds && endedAt < endSeconds) {
        churnedMrrCents += mrr;
      }
    }

    return {
      month: start.toISOString().slice(0, 7),
      label: new Intl.DateTimeFormat("en-US", {
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      }).format(start),
      mrrCents: Math.round(mrrCents),
      newMrrCents: Math.round(newMrrCents),
      churnedMrrCents: Math.round(churnedMrrCents),
    };
  });

  const nowSeconds = now.getTime() / 1000;
  const customerMrr = new Map<string, { id: string; name: string; email: string | null; mrrCents: number }>();
  for (const subscription of eligible) {
    const endedAt = subscription.ended_at ?? subscription.canceled_at;
    if (subscription.created > nowSeconds || (endedAt && endedAt <= nowSeconds)) continue;
    const customer = customerDetails(subscription);
    const existing = customerMrr.get(customer.id) ?? { ...customer, mrrCents: 0 };
    existing.mrrCents += monthlyAmountCents(subscription);
    customerMrr.set(customer.id, existing);
  }

  const topCustomers = [...customerMrr.values()]
    .map(customer => ({ ...customer, mrrCents: Math.round(customer.mrrCents) }))
    .sort((a, b) => b.mrrCents - a.mrrCents)
    .slice(0, 10);

  return {
    currency: "usd",
    refreshedAt: now.toISOString(),
    refreshSchedule: "Daily at 7:00 a.m. Central",
    currentMrrCents: monthly.at(-1)?.mrrCents ?? 0,
    monthly,
    topCustomers,
  };
}

async function listSubscriptions(stripe: Stripe): Promise<SubscriptionLike[]> {
  const subscriptions: SubscriptionLike[] = [];
  let startingAfter: string | undefined;
  do {
    const page = await stripe.subscriptions.list({
      status: "all",
      limit: 100,
      starting_after: startingAfter,
      expand: ["data.customer"],
    });
    subscriptions.push(...page.data as unknown as SubscriptionLike[]);
    startingAfter = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (startingAfter);
  return subscriptions;
}

export type StoredDashboard = {
  refreshBoundary: string;
  dashboard: RevenueDashboard;
};

export interface RevenueDashboardStore {
  read(): Promise<StoredDashboard | null>;
  write(boundary: string, dashboard: RevenueDashboard): Promise<void>;
  withRefreshLock<T>(callback: () => Promise<T>): Promise<T>;
}

class DatabaseRevenueDashboardStore implements RevenueDashboardStore {
  async read(): Promise<StoredDashboard | null> {
    const rows = await db
      .select({
        refreshBoundary: revenueDashboardSnapshots.refreshBoundary,
        snapshot: revenueDashboardSnapshots.snapshot,
      })
      .from(revenueDashboardSnapshots)
      .where(eq(revenueDashboardSnapshots.key, SNAPSHOT_KEY))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      refreshBoundary: row.refreshBoundary,
      dashboard: row.snapshot as RevenueDashboard,
    };
  }

  async write(
    boundary: string,
    dashboard: RevenueDashboard,
  ): Promise<void> {
    await db
      .insert(revenueDashboardSnapshots)
      .values({
        key: SNAPSHOT_KEY,
        refreshBoundary: boundary,
        snapshot: dashboard,
        refreshedAt: new Date(dashboard.refreshedAt),
      })
      .onConflictDoUpdate({
        target: revenueDashboardSnapshots.key,
        set: {
          refreshBoundary: boundary,
          snapshot: dashboard,
          refreshedAt: new Date(dashboard.refreshedAt),
        },
      });
  }

  async withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
    const lock = await pool.connect();
    let acquired = false;
    try {
      await lock.query(
        "select pg_advisory_lock(hashtext($1))",
        [REFRESH_LOCK_KEY],
      );
      acquired = true;
      return await callback();
    } finally {
      try {
        if (acquired) {
          await lock.query(
            "select pg_advisory_unlock(hashtext($1))",
            [REFRESH_LOCK_KEY],
          );
        }
      } finally {
        lock.release();
      }
    }
  }
}

const dashboardStore = new DatabaseRevenueDashboardStore();

export async function refreshRevenueDashboardWithStore(
  store: RevenueDashboardStore,
  loadSubscriptions: () => Promise<SubscriptionLike[]>,
  now = new Date(),
): Promise<RevenueDashboard> {
  return store.withRefreshLock(async () => {
    const boundary = refreshBoundary(now);
    const stored = await store.read();
    if (stored?.refreshBoundary === boundary) return stored.dashboard;

    const subscriptions = await loadSubscriptions();
    const dashboard = calculateRevenueDashboard(subscriptions, now);
    await store.write(boundary, dashboard);
    return dashboard;
  });
}

async function refreshRevenueDashboard(): Promise<RevenueDashboard> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    let refreshedSubscriptionCount: number | null = null;
    const dashboard = await refreshRevenueDashboardWithStore(
      dashboardStore,
      async () => {
        const stripe = await getUncachableStripeClient();
        const subscriptions = await listSubscriptions(stripe);
        refreshedSubscriptionCount = subscriptions.length;
        return subscriptions;
      },
    );
    if (refreshedSubscriptionCount !== null) {
      logger.info(
        {
          subscriptionCount: refreshedSubscriptionCount,
          refreshedAt: dashboard.refreshedAt,
        },
        "Refreshed Stripe revenue dashboard",
      );
    }
    return dashboard;
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function refreshIfDue(): Promise<RevenueDashboard> {
  const stored = await dashboardStore.read();
  if (stored?.refreshBoundary === refreshBoundary(new Date())) {
    return stored.dashboard;
  }
  try {
    return await refreshRevenueDashboard();
  } catch (err) {
    if (stored) {
      logger.error({ err }, "Stripe revenue refresh failed; serving last successful snapshot");
      return stored.dashboard;
    }
    throw err;
  }
}

export function startRevenueDashboardSchedule(): void {
  if (schedulerStarted) return;
  schedulerStarted = true;
  const timer = setInterval(() => {
    void refreshIfDue().catch(err => {
      logger.error({ err }, "Scheduled Stripe revenue dashboard refresh failed");
    });
  }, REFRESH_CHECK_MS);
  timer.unref();
}

export function registerRevenueDashboardRoutes(app: Express): void {
  app.get("/api/admin/revenue", isAuthenticated, async (req, res, next) => {
    if (!isIncidentAdmin(getUserId(req))) {
      return res.status(403).json({ message: "Admin only" });
    }
    try {
      const dashboard = await refreshIfDue();
      res.setHeader("Cache-Control", "private, no-store");
      return res.status(200).json(dashboard);
    } catch (err) {
      return next(err);
    }
  });
}