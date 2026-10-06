import { pgTable, serial, integer, text, varchar, timestamp, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { orders, payouts } from "./schema";
import { users } from "./models/auth";

export const incidents = pgTable("incidents", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().unique().references(() => orders.id),
  customerId: varchar("customer_id").notNull().references(() => users.id),
  washerId: varchar("washer_id").notNull().references(() => users.id),
  category: text("category").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("submitted"),
  washerResponse: text("washer_response"),
  reviewNote: text("review_note"),
  reviewedBy: varchar("reviewed_by"),
  reimbursementCents: integer("reimbursement_cents").notNull().default(0),
  reimbursementStatus: text("reimbursement_status").notNull().default("none"),
  reimbursementAccountId: text("reimbursement_account_id"),
  transferId: text("transfer_id").unique(),
  bankPayoutId: text("bank_payout_id").unique(),
  transferAttemptAt: timestamp("transfer_attempt_at"),
  payoutAttemptAt: timestamp("payout_attempt_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [
  check("incident_amount_bounds", sql`${t.reimbursementCents} BETWEEN 0 AND 5000`),
  check("incident_status_valid", sql`${t.status} IN ('submitted','approved','rejected')`),
  check("incident_reimbursement_status_valid", sql`${t.reimbursementStatus} IN ('none','pending','paid','failed')`),
  check("incident_category_valid", sql`${t.category} IN ('missing','damaged','sentimental','valuable')`),
]);

export const incidentEvidence = pgTable("incident_evidence", {
  id: text("id").primaryKey(),
  incidentId: integer("incident_id").notNull().references(() => incidents.id),
  uploaderId: varchar("uploader_id").notNull().references(() => users.id),
  objectKey: text("object_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const incidentFees = pgTable("incident_fees", {
  id: serial("id").primaryKey(),
  incidentId: integer("incident_id").notNull().unique().references(() => incidents.id),
  washerId: varchar("washer_id").notNull().references(() => users.id),
  amountCents: integer("amount_cents").notNull().default(399),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, t => [check("incident_fee_exact", sql`${t.amountCents} = 399`)]);

// Pending allocations reserve debt; paid allocations settle it; failed allocations
// are released by the payout status. Never mutate/delete the original fee.
export const incidentFeeAllocations = pgTable("incident_fee_allocations", {
  id: serial("id").primaryKey(),
  feeId: integer("fee_id").notNull().references(() => incidentFees.id),
  payoutId: integer("payout_id").notNull().references(() => payouts.id),
  amountCents: integer("amount_cents").notNull(),
}, t => [
  uniqueIndex("incident_fee_payout_unique").on(t.feeId, t.payoutId),
  check("incident_allocation_positive", sql`${t.amountCents} > 0 AND ${t.amountCents} <= 399`),
]);

export const reimbursementAccounts = pgTable("reimbursement_accounts", {
  userId: varchar("user_id").primaryKey().references(() => users.id),
  accountId: text("account_id").unique(),
  attemptedAt: timestamp("attempted_at").notNull().defaultNow(),
});