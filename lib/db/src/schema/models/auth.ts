import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

// User storage table. Primary key is the Clerk user id (user_xxx).
export const users = pgTable("users", {
  id: varchar("id").primaryKey(),
  email: varchar("email").notNull(),
  firstName: varchar("first_name"),
  lastName: varchar("last_name"),
  profileImageUrl: varchar("profile_image_url"),
  role: text("role", { enum: ['customer', 'washer'] }),
  address: text("address"),
  // Server-owned state for the one-time customer unlock. Stripe resource IDs
  // are references only; Stripe remains the payment source of truth.
  customerStripeCustomerId: text("customer_stripe_customer_id").unique(),
  customerUnlockPaymentIntentId: text("customer_unlock_payment_intent_id").unique(),
  customerUnlockedAt: timestamp("customer_unlocked_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type PublicUser = User;
