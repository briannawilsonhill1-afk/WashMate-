import { pgTable, text, integer, timestamp, index } from "drizzle-orm/pg-core";

export const pushReceiptQueue = pgTable(
  "push_receipt_queue",
  {
    ticketId: text("ticket_id").primaryKey(),
    token: text("token").notNull(),
    dueAt: timestamp("due_at").notNull(),
    attempts: integer("attempts").notNull().default(0),
    claimId: text("claim_id"),
    claimUntil: timestamp("claim_until"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => [
    index("IDX_push_receipt_queue_due").on(table.dueAt),
    index("IDX_push_receipt_queue_claim").on(table.claimUntil),
  ],
);

export type PushReceiptQueueEntry = typeof pushReceiptQueue.$inferSelect;
export type InsertPushReceiptQueueEntry = typeof pushReceiptQueue.$inferInsert;