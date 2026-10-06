import { describe, expect, it, vi } from "vitest";
import {
  calculateRevenueDashboard,
  refreshRevenueDashboardWithStore,
  type RevenueDashboard,
  type RevenueDashboardStore,
} from "./revenueDashboard";

const subscription = (
  id: string,
  created: string,
  canceled: string | null,
  monthlyCents: number,
  customerId = id,
) => ({
  id,
  created: Date.parse(created) / 1000,
  canceled_at: canceled ? Date.parse(canceled) / 1000 : null,
  ended_at: canceled ? Date.parse(canceled) / 1000 : null,
  status: canceled ? "canceled" : "active",
  customer: { id: customerId, name: `Customer ${customerId}`, email: `${customerId}@example.com` },
  items: {
    data: [{
      quantity: 1,
      price: {
        unit_amount: monthlyCents,
        recurring: { interval: "month" as const, interval_count: 1 },
      },
    }],
  },
});

describe("calculateRevenueDashboard", () => {
  it("calculates monthly, new, and churned MRR", () => {
    const result = calculateRevenueDashboard([
      subscription("existing", "2025-01-05T00:00:00Z", null, 5000),
      subscription("new", "2026-08-10T00:00:00Z", null, 3000),
      subscription("churned", "2025-10-01T00:00:00Z", "2026-08-20T00:00:00Z", 2000),
    ], new Date("2026-09-22T12:00:00Z"));

    const august = result.monthly.find(month => month.month === "2026-08");
    expect(august).toMatchObject({
      mrrCents: 8000,
      newMrrCents: 3000,
      churnedMrrCents: 2000,
    });
    expect(result.currentMrrCents).toBe(8000);
  });

  it("groups active MRR by customer and ranks the largest customers", () => {
    const result = calculateRevenueDashboard([
      subscription("one", "2026-01-01T00:00:00Z", null, 2000, "shared"),
      subscription("two", "2026-02-01T00:00:00Z", null, 4000, "shared"),
      subscription("three", "2026-03-01T00:00:00Z", null, 5000, "other"),
    ], new Date("2026-09-22T12:00:00Z"));

    expect(result.topCustomers[0]).toMatchObject({ id: "shared", mrrCents: 6000 });
    expect(result.topCustomers[1]).toMatchObject({ id: "other", mrrCents: 5000 });
  });
});

class SharedTestStore implements RevenueDashboardStore {
  stored: { refreshBoundary: string; dashboard: RevenueDashboard } | null = null;
  private tail = Promise.resolve();

  async read() {
    return this.stored;
  }

  async write(refreshBoundary: string, dashboard: RevenueDashboard) {
    this.stored = { refreshBoundary, dashboard };
  }

  async withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await callback();
    } finally {
      release();
    }
  }
}

describe("shared revenue refresh coordination", () => {
  const now = new Date("2026-09-22T13:00:00Z");

  it("performs one provider fetch for racing API instances", async () => {
    const store = new SharedTestStore();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const load = vi.fn(async () => {
      await blocked;
      return [subscription("one", "2026-01-01T00:00:00Z", null, 5000)];
    });

    const first = refreshRevenueDashboardWithStore(store, load, now);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    const second = refreshRevenueDashboardWithStore(store, load, now);
    release();

    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(secondResult).toEqual(firstResult);
    expect(secondResult.refreshedAt).toBe(firstResult.refreshedAt);
  });

  it("retains the previous snapshot when a refresh fails", async () => {
    const store = new SharedTestStore();
    const previous = calculateRevenueDashboard(
      [subscription("old", "2025-01-01T00:00:00Z", null, 2000)],
      new Date("2026-09-21T13:00:00Z"),
    );
    store.stored = { refreshBoundary: "2026-09-21", dashboard: previous };

    await expect(refreshRevenueDashboardWithStore(
      store,
      vi.fn().mockRejectedValue(new Error("Stripe unavailable")),
      now,
    )).rejects.toThrow("Stripe unavailable");

    expect(store.stored).toEqual({
      refreshBoundary: "2026-09-21",
      dashboard: previous,
    });
  });
});