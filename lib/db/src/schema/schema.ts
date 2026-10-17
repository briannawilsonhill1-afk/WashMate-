import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
import { users } from "./models/auth";

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  washerId: varchar("washer_id"),
  status: text("status", { enum: ['pending', 'accepted', 'picked_up', 'in_progress', 'out_for_delivery', 'completed'] }).notNull().default('pending'),
  loadSize: text("load_size", { enum: ['small', 'medium', 'large'] }).notNull(),
  flatFee: integer("flat_fee").notNull(),
  extraFolding: boolean("extra_folding").notNull().default(false),
  hasPetHair: boolean("has_pet_hair").notNull().default(false),
  heavilySoiled: boolean("heavily_soiled").notNull().default(false),
  soilNotes: text("soil_notes"),
  soapPreference: text("soap_preference", { enum: ['customer_provided', 'washer_provided'] }).notNull().default('washer_provided'),
  pickupFee: integer("pickup_fee").notNull().default(0),
  soiledFee: integer("soiled_fee").notNull().default(0),
  totalFee: integer("total_fee").notNull(),
  pickupAddress: text("pickup_address"),
  recurringInterval: text("recurring_interval", { enum: ['none', 'weekly', 'biweekly', 'monthly'] }).notNull().default('none'),
  // Payout tracking — set when this completed order is rolled into a payout
  // batch for the assigned washer. NULL means the washer's share is still
  // unpaid / pending payout.
  payoutId: integer("payout_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Washer earnings rollups. Each payout aggregates one or more completed orders
// for a single washer and tracks the lifecycle of moving funds to the washer's
// verified Stripe Financial Connections bank account. Amounts are in cents
// (USD) for precision; orders.totalFee is whole dollars and is converted on
// the way in. We snapshot the bank metadata at payout time so historical
// records remain accurate even if the washer later re-verifies a different
// bank account.
export const payouts = pgTable("payouts", {
  id: serial("id").primaryKey(),
  washerId: varchar("washer_id").notNull(),
  totalFeeCents: integer("total_fee_cents").notNull(),
  platformFeeCents: integer("platform_fee_cents").notNull(),
  amountCents: integer("amount_cents").notNull(),
  incidentFeeCents: integer("incident_fee_cents").notNull().default(0),
  transferAttemptAt: timestamp("transfer_attempt_at"),
  orderCount: integer("order_count").notNull(),
  status: text("status", { enum: ['pending', 'paid', 'failed'] }).notNull().default('pending'),
  // Stripe object ids tying the local payout row to the actual money movement.
  // stripeTransferId — platform → washer Connect account transfer.
  // stripePayoutId — Connect account → washer's external bank payout.
  stripeTransferId: text("stripe_transfer_id"),
  stripePayoutId: text("stripe_payout_id").unique(),
  stripeConnectAccountId: text("stripe_connect_account_id"),
  stripeBankAccountId: text("stripe_bank_account_id").notNull(),
  verifiedBankName: text("verified_bank_name"),
  verifiedAccountLast4: text("verified_account_last4"),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  paidAt: timestamp("paid_at"),
});

export const washerProfiles = pgTable("washer_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  legalName: text("legal_name").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  phone: text("phone").notNull(),
  taxId: text("tax_id").notNull(),
  businessName: text("business_name"),
  bankName: text("bank_name"),
  accountHolderName: text("account_holder_name"),
  routingNumber: text("routing_number"),
  accountNumber: text("account_number"),
  accountType: text("account_type", { enum: ['checking', 'savings'] }).notNull().default('checking'),
  // Stripe Financial Connections — populated when the washer verifies their
  // bank via Stripe FC. When set, manual routingNumber/accountNumber are
  // not required. The Stripe IDs are non-secret resource identifiers and
  // are NOT encrypted at rest; bank metadata is shown unmasked because it
  // mirrors what the user explicitly verified.
  stripeCustomerId: text("stripe_customer_id"),
  stripeBankAccountId: text("stripe_bank_account_id"),
  // Stripe Connect Custom account id used to actually push payouts to the
  // washer's external bank. Created lazily when the washer first verifies a
  // bank account; the verified FC bank is attached as the Connect account's
  // external_account so payouts route to it.
  stripeConnectAccountId: text("stripe_connect_account_id"),
  // Financial Connections account last attached to the Connect account.
  // A mismatch means bank re-verification must update the Connect default.
  stripeConnectBankAccountId: text("stripe_connect_bank_account_id"),
  verifiedBankName: text("verified_bank_name"),
  verifiedAccountLast4: text("verified_account_last4"),
  stripeVerifiedAt: timestamp("stripe_verified_at"),
  agreedToTerms: boolean("agreed_to_terms").notNull().default(false),
  // Stripe Connect Terms-of-Service acceptance evidence. Recorded server-side
  // when the washer agrees to the washer terms, using the client IP observed
  // at the trusted proxy boundary. This evidence is required before a
  // Connect account is created — it is never fabricated or defaulted.
  tosAcceptedAt: timestamp("tos_accepted_at"),
  tosAcceptedIp: text("tos_accepted_ip"),
  tosVersion: text("tos_version"),
  county: text("county"),
  state: text("state"),
  bgCheckConsent: boolean("bg_check_consent").notNull().default(false),
  bgSelfCertify: boolean("bg_self_certify").notNull().default(false),
  bgCheckStatus: text("bg_check_status", { enum: ['not_started', 'pending', 'cleared', 'flagged', 'provider_failed', 'pre_adverse_action', 'adverse_action_final'] }).notNull().default('not_started'),
  bgCheckDate: timestamp("bg_check_date"),
  // Checkr screening workflow state. All of these are server-managed: they
  // are set only by the Checkr invitation flow and the verified Checkr
  // webhook, and must never be writable from client input or returned to
  // clients. Only coarse outcome data is stored — never report details.
  bgCheckProvider: text("bg_check_provider"),
  checkrCandidateId: text("checkr_candidate_id"),
  checkrInvitationId: text("checkr_invitation_id"),
  checkrReportId: text("checkr_report_id"),
  bgCheckRequestedAt: timestamp("bg_check_requested_at"),
  bgCheckDecidedAt: timestamp("bg_check_decided_at"),
  bgCheckResult: text("bg_check_result", { enum: ['clear', 'consider', 'suspended'] }),
  // FCRA written-authorization evidence. The standalone disclosure is shown on
  // its own screen and the authorization is a separate, explicit act recorded
  // here with timestamp + client IP + the disclosure version the washer saw.
  // Server-managed: never writable from client input, IP never returned to clients.
  // Screening cannot start without a valid authorization (fail-closed).
  fcraDisclosureVersion: text("fcra_disclosure_version"),
  fcraAuthorizedAt: timestamp("fcra_authorized_at"),
  fcraAuthorizedIp: text("fcra_authorized_ip"),
  // Adverse-action workflow state. When a report comes back "consider", the
  // washer is flagged; before any final decision, an admin sends a pre-adverse
  // notice, waits the configured business-day period, then records the final
  // decision. Every transition is audited in washer_bg_check_events.
  preAdverseSentAt: timestamp("pre_adverse_sent_at"),
  preAdverseNoticeVersion: text("pre_adverse_notice_version"),
  adverseActionFinalAt: timestamp("adverse_action_final_at"),
  adverseActionNoticeVersion: text("adverse_action_notice_version"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Append-only record of screening submissions and decisions. Provider findings
// are intentionally represented by a privacy-safe reason code and reference;
// sensitive reports never belong in the application database or API response.
export const washerBgCheckEvents = pgTable("washer_bg_check_events", {
  id: serial("id").primaryKey(),
  washerId: varchar("washer_id").notNull(),
  fromStatus: text("from_status", { enum: ['not_started', 'pending', 'cleared', 'flagged', 'provider_failed', 'pre_adverse_action', 'adverse_action_final'] }),
  toStatus: text("to_status", { enum: ['not_started', 'pending', 'cleared', 'flagged', 'provider_failed', 'pre_adverse_action', 'adverse_action_final'] }).notNull(),
  actorType: text("actor_type", { enum: ['washer', 'operator', 'provider', 'system', 'admin'] }).notNull(),
  actorId: varchar("actor_id"),
  providerReference: text("provider_reference"),
  reasonCode: text("reason_code").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, status: true, washerId: true, customerId: true, totalFee: true, flatFee: true, pickupFee: true, soiledFee: true, pickupAddress: true });
// Stripe-controlled fields are server-managed (set only via the FC complete
// endpoint after verifying the Stripe session) and must never be writable
// from client input.
export const insertWasherProfileSchema = createInsertSchema(washerProfiles).omit({
  id: true,
  updatedAt: true,
  userId: true,
  bgCheckStatus: true,
  bgCheckDate: true,
  stripeCustomerId: true,
  stripeBankAccountId: true,
  stripeConnectAccountId: true,
  stripeConnectBankAccountId: true,
  verifiedBankName: true,
  verifiedAccountLast4: true,
  stripeVerifiedAt: true,
  // ToS acceptance evidence is server-managed (captured from the request at
  // the trusted proxy boundary when the washer agrees) and must never be
  // writable from client input.
  tosAcceptedAt: true,
  tosAcceptedIp: true,
  tosVersion: true,
  // Checkr screening workflow state is server-managed (set by the invitation
  // flow and the verified Checkr webhook) and must never be writable from
  // client input.
  bgCheckProvider: true,
  checkrCandidateId: true,
  checkrInvitationId: true,
  checkrReportId: true,
  bgCheckRequestedAt: true,
  bgCheckDecidedAt: true,
  bgCheckResult: true,
  // FCRA authorization evidence and adverse-action workflow state are
  // server-managed (recorded from the standalone disclosure/authorization
  // flow and admin adverse-action endpoints) and must never be writable from
  // client input.
  fcraDisclosureVersion: true,
  fcraAuthorizedAt: true,
  fcraAuthorizedIp: true,
  preAdverseSentAt: true,
  preAdverseNoticeVersion: true,
  adverseActionFinalAt: true,
  adverseActionNoticeVersion: true,
});

export const profileUpdateSchema = z.object({
  role: z.enum(['customer', 'washer']),
  address: z.string().min(5, 'Address is required'),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type WasherProfile = typeof washerProfiles.$inferSelect;
export type InsertWasherProfile = z.infer<typeof insertWasherProfileSchema>;
export type WasherBgCheckEvent = typeof washerBgCheckEvents.$inferSelect;

export type Payout = typeof payouts.$inferSelect;

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const SENSITIVE_FIELD_MASK = 'WASHMATE_MASKED';

// Platform takes 20% of each completed order; the washer keeps the rest.
// Stored in basis points so the split is exact and reviewable.
export const PLATFORM_FEE_BPS = 2000;
