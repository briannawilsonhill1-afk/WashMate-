import { pgTable, serial, text, timestamp, varchar, index } from "drizzle-orm/pg-core";

export const deviceTokens = pgTable(
  "device_tokens",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id").notNull(),
    token: text("token").notNull().unique(),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull().default("ios"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => [index("IDX_device_tokens_user").on(table.userId)],
);

export type DeviceToken = typeof deviceTokens.$inferSelect;
export type InsertDeviceToken = typeof deviceTokens.$inferInsert;
