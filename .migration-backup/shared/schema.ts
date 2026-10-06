import { pgTable, text, serial, integer, boolean, timestamp, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export * from "./models/auth";
import { users } from "./models/auth";

export const orders = pgTable("orders", {
  id: serial("id").primaryKey(),
  customerId: varchar("customer_id").notNull(),
  washerId: varchar("washer_id"),
  status: text("status", { enum: ['pending', 'accepted', 'in_progress', 'completed'] }).notNull().default('pending'),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const washerProfiles = pgTable("washer_profiles", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull().unique(),
  legalName: text("legal_name").notNull(),
  dateOfBirth: text("date_of_birth").notNull(),
  phone: text("phone").notNull(),
  taxId: text("tax_id").notNull(),
  businessName: text("business_name"),
  bankName: text("bank_name").notNull(),
  accountHolderName: text("account_holder_name").notNull(),
  routingNumber: text("routing_number").notNull(),
  accountNumber: text("account_number").notNull(),
  accountType: text("account_type", { enum: ['checking', 'savings'] }).notNull().default('checking'),
  agreedToTerms: boolean("agreed_to_terms").notNull().default(false),
  county: text("county"),
  state: text("state"),
  bgCheckConsent: boolean("bg_check_consent").notNull().default(false),
  bgSelfCertify: boolean("bg_self_certify").notNull().default(false),
  bgCheckStatus: text("bg_check_status", { enum: ['not_started', 'pending', 'cleared', 'flagged'] }).notNull().default('not_started'),
  bgCheckDate: timestamp("bg_check_date"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertOrderSchema = createInsertSchema(orders).omit({ id: true, createdAt: true, status: true, washerId: true, customerId: true, totalFee: true, flatFee: true, pickupFee: true, soiledFee: true, pickupAddress: true });
export const insertWasherProfileSchema = createInsertSchema(washerProfiles).omit({ id: true, updatedAt: true, userId: true, bgCheckStatus: true, bgCheckDate: true });

export const profileUpdateSchema = z.object({
  role: z.enum(['customer', 'washer']),
  address: z.string().min(5, 'Address is required'),
});

export type Order = typeof orders.$inferSelect;
export type InsertOrder = z.infer<typeof insertOrderSchema>;

export type WasherProfile = typeof washerProfiles.$inferSelect;
export type InsertWasherProfile = z.infer<typeof insertWasherProfileSchema>;

export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export const SENSITIVE_FIELD_MASK = 'WASHMATE_MASKED';
