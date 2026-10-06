import { index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const activeUsers = pgTable(
  "active_users",
  {
    identifierHash: varchar("identifier_hash", { length: 64 }).primaryKey(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("IDX_active_users_last_seen").on(table.lastSeenAt)],
);

export type ActiveUser = typeof activeUsers.$inferSelect;
export type InsertActiveUser = typeof activeUsers.$inferInsert;