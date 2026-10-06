import { db } from "./db";
import { orders, washerProfiles, users } from "@shared/schema";
import type { Order, InsertOrder, WasherProfile, InsertWasherProfile, User } from "@shared/schema";
import { eq, and, isNull, inArray, sql } from "drizzle-orm";
import { encryptField, decryptField, isEncrypted } from "./encryption";

function encryptStr<T extends string | null | undefined>(value: T): T {
  if (value == null || value === "") return value;
  return encryptField(value as string) as T;
}

function decryptStr<T extends string | null | undefined>(value: T): T {
  if (value == null) return value;
  return (isEncrypted(value as string) ? decryptField(value as string) : value) as T;
}

function encryptSensitiveFields(profile: InsertWasherProfile & { userId: string }): typeof profile {
  return {
    ...profile,
    legalName: encryptStr(profile.legalName),
    dateOfBirth: encryptStr(profile.dateOfBirth),
    phone: encryptStr(profile.phone),
    taxId: encryptStr(profile.taxId),
    businessName: encryptStr(profile.businessName),
    bankName: encryptStr(profile.bankName),
    accountHolderName: encryptStr(profile.accountHolderName),
    routingNumber: encryptStr(profile.routingNumber),
    accountNumber: encryptStr(profile.accountNumber),
    county: encryptStr(profile.county),
    state: encryptStr(profile.state),
  };
}

function decryptSensitiveFields(profile: WasherProfile): WasherProfile {
  return {
    ...profile,
    legalName: decryptStr(profile.legalName),
    dateOfBirth: decryptStr(profile.dateOfBirth),
    phone: decryptStr(profile.phone),
    taxId: decryptStr(profile.taxId),
    businessName: decryptStr(profile.businessName),
    bankName: decryptStr(profile.bankName),
    accountHolderName: decryptStr(profile.accountHolderName),
    routingNumber: decryptStr(profile.routingNumber),
    accountNumber: decryptStr(profile.accountNumber),
    county: decryptStr(profile.county),
    state: decryptStr(profile.state),
  };
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  updateUserProfile(id: string, data: { role: 'customer' | 'washer'; address: string }): Promise<User>;

  getOrders(): Promise<Order[]>;
  getOrder(id: number): Promise<Order | undefined>;
  createOrder(order: InsertOrder & { customerId: string; flatFee: number; pickupFee: number; soiledFee: number; totalFee: number; pickupAddress: string }): Promise<Order>;
  updateOrderStatus(id: number, status: string): Promise<Order>;
  claimOrder(id: number, washerId: string): Promise<Order>;

  getWasherProfile(userId: string): Promise<WasherProfile | undefined>;
  getWasherBgCheckStatus(userId: string): Promise<{ bgCheckStatus: WasherProfile['bgCheckStatus'] } | undefined>;
  upsertWasherProfile(profile: InsertWasherProfile & { userId: string }): Promise<WasherProfile>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async updateUserProfile(id: string, data: { role: 'customer' | 'washer'; address: string }): Promise<User> {
    if (data.role === 'customer') {
      return await db.transaction(async (tx) => {
        // Lock the user row to serialize concurrent role-switch requests
        await tx.execute(sql`SELECT id FROM users WHERE id = ${id} FOR UPDATE`);

        // Within the same transaction, check for active orders so the check and
        // update are atomic — preventing a race where a claim commits between the
        // check and the UPDATE in application code.
        const activeOrders = await tx
          .select({ id: orders.id })
          .from(orders)
          .where(and(eq(orders.washerId, id), inArray(orders.status, ['accepted', 'in_progress'])));

        if (activeOrders.length > 0) {
          throw new Error('HAS_ACTIVE_ORDERS');
        }

        const [user] = await tx
          .update(users)
          .set({ role: data.role, address: data.address, updatedAt: new Date() })
          .where(eq(users.id, id))
          .returning();
        return user;
      });
    }

    const [user] = await db.update(users)
      .set({ role: data.role, address: data.address, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return user;
  }

  async getOrders(): Promise<Order[]> {
    return await db.select().from(orders);
  }

  async getOrder(id: number): Promise<Order | undefined> {
    const [order] = await db.select().from(orders).where(eq(orders.id, id));
    return order;
  }

  async createOrder(insertOrder: InsertOrder & { customerId: string; flatFee: number; pickupFee: number; soiledFee: number; totalFee: number; pickupAddress: string }): Promise<Order> {
    const [order] = await db.insert(orders).values(insertOrder).returning();
    return order;
  }

  async updateOrderStatus(id: number, status: string): Promise<Order> {
    const validStatus = status as 'pending' | 'accepted' | 'in_progress' | 'completed';
    const updateData: Partial<typeof orders.$inferInsert> = { status: validStatus };
    if (validStatus === 'completed') {
      updateData.pickupAddress = null;
    }
    const [order] = await db.update(orders).set(updateData).where(eq(orders.id, id)).returning();
    return order;
  }

  async claimOrder(id: number, washerId: string): Promise<Order> {
    return await db.transaction(async (tx) => {
      // Lock the washer's user row — the same row the role-switch transaction
      // locks. This serializes concurrent claim and role-downgrade requests so
      // neither can succeed after the other has already committed a conflicting
      // state change.
      const lockResult = await tx.execute(
        sql`SELECT id, role FROM users WHERE id = ${washerId} FOR UPDATE`
      );
      const washerUser = (lockResult.rows[0] ?? null) as { id: string; role: string } | null;

      if (!washerUser || washerUser.role !== 'washer') {
        throw new Error('WASHER_ROLE_LOST');
      }

      // Re-verify background-check clearance inside the transaction
      const [profile] = await tx
        .select({ bgCheckStatus: washerProfiles.bgCheckStatus })
        .from(washerProfiles)
        .where(eq(washerProfiles.userId, washerId));

      if (!profile || profile.bgCheckStatus !== 'cleared') {
        throw new Error('WASHER_NOT_CLEARED');
      }

      const [order] = await tx
        .update(orders)
        .set({ washerId, status: 'accepted' })
        .where(and(eq(orders.id, id), eq(orders.status, 'pending'), isNull(orders.washerId)))
        .returning();

      if (!order) {
        throw new Error('ORDER_ALREADY_CLAIMED');
      }
      return order;
    });
  }

  async getWasherProfile(userId: string): Promise<WasherProfile | undefined> {
    const [profile] = await db.select().from(washerProfiles).where(eq(washerProfiles.userId, userId));
    if (!profile) return undefined;
    return decryptSensitiveFields(profile);
  }

  async getWasherBgCheckStatus(userId: string): Promise<{ bgCheckStatus: WasherProfile['bgCheckStatus'] } | undefined> {
    const [row] = await db
      .select({ bgCheckStatus: washerProfiles.bgCheckStatus })
      .from(washerProfiles)
      .where(eq(washerProfiles.userId, userId));
    return row;
  }

  async upsertWasherProfile(profile: InsertWasherProfile & { userId: string }): Promise<WasherProfile> {
    const existing = await this.getWasherProfile(profile.userId);

    // bgCheckStatus and bgCheckDate are omitted from InsertWasherProfile and are
    // exclusively derived from server-side logic here — never from client input.
    let serverVerification: { bgCheckStatus: 'pending'; bgCheckDate: Date } | undefined;
    if (profile.bgCheckConsent && profile.bgSelfCertify && profile.county && profile.state) {
      if (!existing || existing.bgCheckStatus === 'not_started') {
        serverVerification = { bgCheckStatus: 'pending', bgCheckDate: new Date() };
      }
    }

    const encryptedProfile = encryptSensitiveFields(profile);

    if (existing) {
      const [updated] = await db.update(washerProfiles)
        .set({ ...encryptedProfile, ...serverVerification, updatedAt: new Date() })
        .where(eq(washerProfiles.userId, profile.userId))
        .returning();
      return decryptSensitiveFields(updated);
    }

    const [created] = await db.insert(washerProfiles)
      .values({ ...encryptedProfile, ...serverVerification })
      .returning();
    return decryptSensitiveFields(created);
  }
}

export const storage = new DatabaseStorage();
