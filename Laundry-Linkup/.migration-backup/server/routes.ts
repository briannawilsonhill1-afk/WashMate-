import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated, getUserId, toPublicUser } from "./auth";
import { profileUpdateSchema, SENSITIVE_FIELD_MASK, type WasherProfile } from "@shared/schema";

function sanitizeOrder<T extends { pickupAddress?: string | null }>(order: T): Omit<T, 'pickupAddress'> {
  const { pickupAddress: _removed, ...safe } = order;
  return safe as Omit<T, 'pickupAddress'>;
}

function sanitizePendingOrderForWasher(order: { id: number; status: string; loadSize: string; flatFee: number; extraFolding: boolean; hasPetHair: boolean; heavilySoiled: boolean; soapPreference: string; pickupFee: number; soiledFee: number; totalFee: number; washerId?: string | null }) {
  return {
    id: order.id,
    status: order.status,
    loadSize: order.loadSize,
    flatFee: order.flatFee,
    extraFolding: order.extraFolding,
    hasPetHair: order.hasPetHair,
    heavilySoiled: order.heavilySoiled,
    soapPreference: order.soapPreference,
    pickupFee: order.pickupFee,
    soiledFee: order.soiledFee,
    totalFee: order.totalFee,
    washerId: order.washerId ?? null,
  };
}

function maskWasherProfile(profile: WasherProfile) {
  return {
    ...profile,
    taxId: SENSITIVE_FIELD_MASK,
    routingNumber: SENSITIVE_FIELD_MASK,
    accountNumber: SENSITIVE_FIELD_MASK,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  await setupAuth(app);
  registerAuthRoutes(app);

  // Profile setup (role + address)
  app.post(api.profile.update.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const input = profileUpdateSchema.parse(req.body);
      const user = await storage.updateUserProfile(userId, input);
      res.status(200).json(toPublicUser(user));
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      if (err?.message === 'HAS_ACTIVE_ORDERS') {
        return res.status(409).json({
          message: "You have active orders in progress. Complete all assigned orders before switching roles.",
        });
      }
      throw err;
    }
  });

  app.get(api.orders.list.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user || !user.role) {
      return res.status(200).json([]);
    }

    const allOrders = await storage.getOrders();
    const status = req.query.status as string;
    let filtered = allOrders;

    if (user.role === 'customer') {
      filtered = filtered.filter(o => o.customerId === userId);
      if (status) {
        filtered = filtered.filter(o => o.status === status);
      }
      return res.status(200).json(filtered.map(sanitizeOrder));
    } else if (user.role === 'washer') {
      const washerProfile = await storage.getWasherProfile(userId);
      const isCleared = washerProfile?.bgCheckStatus === 'cleared';
      if (isCleared) {
        filtered = filtered.filter(o => o.status === 'pending' || o.washerId === userId);
      } else {
        filtered = filtered.filter(o => o.washerId === userId);
      }
    }

    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }

    res.status(200).json(filtered.map(o => {
      if (o.status === 'pending') {
        return sanitizePendingOrderForWasher(o);
      }
      return sanitizeOrder(o);
    }));
  });

  const LOAD_SIZE_FEES: Record<'small' | 'medium' | 'large', number> = {
    small: 25,
    medium: 35,
    large: 45,
  };

  app.post(api.orders.create.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'customer') {
        return res.status(403).json({ message: "Only customers can create orders" });
      }
      if (!user.address) {
        return res.status(400).json({ message: "You must set a pickup address in your profile before creating an order." });
      }

      const input = api.orders.create.input.parse(req.body);

      const flatFee = LOAD_SIZE_FEES[input.loadSize];
      if (flatFee === undefined) {
        return res.status(400).json({ message: "Invalid load size." });
      }

      const soiledFee = input.heavilySoiled ? 15 : 0;
      const totalFee = flatFee + (input.extraFolding ? 10 : 0) + soiledFee;

      const order = await storage.createOrder({
        ...input,
        customerId: userId,
        flatFee,
        pickupFee: 0,
        soiledFee,
        totalFee,
        pickupAddress: user.address,
      });

      res.status(201).json(sanitizeOrder(order));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  app.patch(api.orders.claim.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only washers can claim orders" });
      }

      const washerProfile = await storage.getWasherProfile(userId);
      if (!washerProfile || washerProfile.bgCheckStatus !== 'cleared') {
        return res.status(403).json({ message: "You must complete the background check verification before claiming jobs." });
      }

      const order = await storage.claimOrder(parseInt(req.params.id), userId);
      res.status(200).json(sanitizeOrder(order));
    } catch (err: any) {
      if (err?.message === 'ORDER_ALREADY_CLAIMED') {
        return res.status(409).json({ message: "This order has already been claimed by another washer." });
      }
      if (err?.message === 'WASHER_ROLE_LOST') {
        return res.status(403).json({ message: "Your account role has changed. Only washers can claim orders." });
      }
      if (err?.message === 'WASHER_NOT_CLEARED') {
        return res.status(403).json({ message: "Your background check verification is required to claim jobs." });
      }
      res.status(404).json({ message: "Order not found" });
    }
  });

  app.get(api.orders.customerAddress.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const orderId = parseInt(req.params.id);

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only active washers can access customer addresses" });
      }

      const washerProfile = await storage.getWasherProfile(userId);
      if (!washerProfile || washerProfile.bgCheckStatus !== 'cleared') {
        return res.status(403).json({ message: "Your background check verification is required to access customer addresses." });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (!order.washerId || order.washerId !== userId) {
        return res.status(403).json({ message: "You are not assigned to this order" });
      }

      const activeStatuses = ['accepted', 'in_progress'];
      if (!activeStatuses.includes(order.status)) {
        return res.status(403).json({ message: "Customer address is only available for active orders" });
      }

      if (!order.pickupAddress) {
        return res.status(404).json({ message: "Customer address not found" });
      }

      res.status(200).json({ address: order.pickupAddress });
    } catch {
      res.status(404).json({ message: "Order not found" });
    }
  });

  const ALLOWED_STATUS_TRANSITIONS: Record<string, string> = {
    accepted: 'in_progress',
    in_progress: 'completed',
  };

  app.patch(api.orders.updateStatus.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only active washers can update order status" });
      }

      const washerProfile = await storage.getWasherProfile(userId);
      if (!washerProfile || washerProfile.bgCheckStatus !== 'cleared') {
        return res.status(403).json({ message: "Your background check verification is required to update order status." });
      }

      const orderId = parseInt(req.params.id);
      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      if (order.washerId !== userId) {
        return res.status(403).json({ message: "Not authorized" });
      }

      const input = api.orders.updateStatus.input.parse(req.body);

      const allowedNext = ALLOWED_STATUS_TRANSITIONS[order.status];
      if (!allowedNext || input.status !== allowedNext) {
        return res.status(400).json({ message: `Invalid status transition from '${order.status}'. Expected '${allowedNext ?? 'none'}'.` });
      }

      const updated = await storage.updateOrderStatus(orderId, input.status);
      res.status(200).json(sanitizeOrder(updated));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      res.status(404).json({ message: "Order not found" });
    }
  });

  app.get(api.washerProfile.get.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const profile = await storage.getWasherProfile(userId);
    if (!profile) {
      return res.status(404).json({ message: "Washer profile not found" });
    }
    res.status(200).json(maskWasherProfile(profile));
  });

  app.get(api.washerProfile.status.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const status = await storage.getWasherBgCheckStatus(userId);
    if (!status) {
      return res.status(404).json({ message: "Washer profile not found" });
    }
    res.status(200).json(status);
  });

  app.post(api.washerProfile.upsert.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const input = api.washerProfile.upsert.input.parse(req.body);

      const existing = await storage.getWasherProfile(userId);
      const profileData = { ...input };
      if (existing) {
        if (profileData.taxId === SENSITIVE_FIELD_MASK) profileData.taxId = existing.taxId;
        if (profileData.routingNumber === SENSITIVE_FIELD_MASK) profileData.routingNumber = existing.routingNumber;
        if (profileData.accountNumber === SENSITIVE_FIELD_MASK) profileData.accountNumber = existing.accountNumber;
      }

      const profile = await storage.upsertWasherProfile({ ...profileData, userId });
      res.status(200).json(maskWasherProfile(profile));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  return httpServer;
}
