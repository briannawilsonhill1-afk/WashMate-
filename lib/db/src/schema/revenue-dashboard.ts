import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const revenueDashboardSnapshots = pgTable("revenue_dashboard_snapshots", {
  key: text("key").primaryKey(),
  refreshBoundary: text("refresh_boundary").notNull(),
  snapshot: jsonb("snapshot").notNull(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull(),
});

export type RevenueDashboardSnapshot =
  typeof revenueDashboardSnapshots.$inferSelect;