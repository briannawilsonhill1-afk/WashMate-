import type { Express } from "express";
import type { Server } from "http";
import { storage } from "../storage";
import { api } from "../shared-routes";
import { z } from "zod";
import { isAuthenticated, getUserId, toPublicUser } from "../auth";
import { profileUpdateSchema, SENSITIVE_FIELD_MASK, type WasherProfile } from "@workspace/db";
import {
  registerDeviceToken,
  unregisterDeviceToken,
  notifyClearedWashersOfNewOrder,
  notifyOrderStatusChange,
} from "../push";
import { extractPickupArea } from "../lib/address-privacy";
import { resolveClientIp } from "../lib/tos";
import { getCheckrConfig, startWasherScreening } from "../lib/checkr";
import {
  FCRA_DISCLOSURE_VERSION,
  FCRA_NOTICE_VERSION,
  addBusinessDays,
  getAdverseActionWaitDays,
  getFcraBusinessDetails,
  isFcraAuthorized,
} from "../lib/fcra";
import { renderFcraDisclosureText } from "../lib/fcraDisclosure";
import {
  CFPB_RIGHTS_URL,
  renderAdverseActionNotice,
  renderPreAdverseNotice,
} from "../lib/fcraNotices";
import { getUncachableStripeClient, getStripePublishableKey } from "../stripeClient";
import {
  executePayout,
  ensureConnectAccount,
  PayoutError,
  WASHER_PAYOUT_FAILURE_REASON,
} from "../payoutService";
import {
  CUSTOMER_UNLOCK_AMOUNT_CENTS,
  CUSTOMER_UNLOCK_CURRENCY,
  CustomerUnlockError,
  CustomerUnlockService,
} from "../customerUnlock";
import {
  registerRevenueDashboardRoutes,
  startRevenueDashboardSchedule,
} from "../revenueDashboard";

function isAdmin(userId: string): boolean {
  const list = (process.env["WASHMATE_ADMIN_USER_IDS"] ?? "")
    .split(",").map(s => s.trim()).filter(Boolean);
  return list.includes(userId);
}

const washerScreeningDecisionSchema = z.object({
  toStatus: z.enum(['cleared', 'flagged', 'provider_failed']),
  providerReference: z.string().trim().min(1).max(200),
  reasonCode: z.enum(['provider_cleared', 'provider_flagged', 'provider_failed']),
}).refine(
  ({ toStatus, reasonCode }) =>
    (toStatus === 'cleared' && reasonCode === 'provider_cleared') ||
    (toStatus === 'flagged' && reasonCode === 'provider_flagged') ||
    (toStatus === 'provider_failed' && reasonCode === 'provider_failed'),
  { message: "Screening status and provider result do not match.", path: ['reasonCode'] },
);
import { clerkClient } from "@clerk/express";
import { registerIncidentRoutes } from "../incidents";

function sanitizeOrder<T extends { pickupAddress?: string | null }>(order: T): Omit<T, 'pickupAddress'> {
  const { pickupAddress: _removed, ...safe } = order;
  return safe as Omit<T, 'pickupAddress'>;
}

function sanitizePendingOrderForWasher(order: { id: number; status: string; loadSize: string; flatFee: number; extraFolding: boolean; hasPetHair: boolean; heavilySoiled: boolean; soapPreference: string; pickupFee: number; soiledFee: number; totalFee: number; washerId?: string | null; pickupAddress?: string | null }) {
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
    pickupArea: extractPickupArea(order.pickupAddress),
  };
}

function maskWasherProfile(profile: WasherProfile) {
  // Preserve null/empty so the client can tell whether a value exists. When
  // present, replace with the sentinel mask so secrets never reach the client.
  // ToS acceptance IP is compliance evidence, not client data — never expose it.
  // Checkr screening identifiers and workflow state are likewise internal.
  // FCRA authorization evidence (IP) is never exposed; the authorized flag is
  // safe for the washer's own UI.
  return {
    ...profile,
    tosAcceptedIp: null,
    bgCheckProvider: null,
    checkrCandidateId: null,
    checkrInvitationId: null,
    checkrReportId: null,
    bgCheckRequestedAt: null,
    bgCheckDecidedAt: null,
    bgCheckResult: null,
    fcraAuthorizedIp: null,
    fcraAuthorized: isFcraAuthorized(profile),
    taxId: profile.taxId ? SENSITIVE_FIELD_MASK : null,
    routingNumber: profile.routingNumber ? SENSITIVE_FIELD_MASK : null,
    accountNumber: profile.accountNumber ? SENSITIVE_FIELD_MASK : null,
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerIncidentRoutes(app);
  registerRevenueDashboardRoutes(app);
  startRevenueDashboardSchedule();

  const unlockService = () =>
    new CustomerUnlockService(storage, getUncachableStripeClient);

  const handleUnlockError = (err: unknown, res: any): boolean => {
    if (!(err instanceof CustomerUnlockError)) return false;
    if (err.code === "CUSTOMER_ONLY") {
      res.status(403).json({ message: err.message, code: err.code });
    } else if (err.code === "PAYMENT_NOT_SUCCEEDED") {
      res.status(409).json({ message: err.message, code: err.code });
    } else {
      res.status(409).json({ message: err.message, code: err.code });
    }
    return true;
  };

  app.get('/api/customer-unlock', isAuthenticated, async (req: any, res) => {
    try {
      const unlocked = await unlockService().status(getUserId(req));
      return res.status(200).json({
        unlocked,
        amountCents: CUSTOMER_UNLOCK_AMOUNT_CENTS,
        currency: CUSTOMER_UNLOCK_CURRENCY,
      });
    } catch (err) {
      if (handleUnlockError(err, res)) return;
      throw err;
    }
  });

  app.post('/api/customer-unlock/payment', isAuthenticated, async (req: any, res) => {
    try {
      const result = await unlockService().payment(getUserId(req));
      if ("unlocked" in result) return res.status(200).json(result);
      return res.status(200).json({
        ...result,
        publishableKey: await getStripePublishableKey(),
      });
    } catch (err) {
      if (handleUnlockError(err, res)) return;
      throw err;
    }
  });

  app.post('/api/customer-unlock/confirm', isAuthenticated, async (req: any, res) => {
    try {
      const result = await unlockService().confirm(getUserId(req));
      return res.status(200).json(result);
    } catch (err) {
      if (handleUnlockError(err, res)) return;
      throw err;
    }
  });

  // Profile setup (role + address)
  app.post(api.profile.update.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const input = profileUpdateSchema.parse(req.body);
      const user = await storage.updateUserProfile(userId, input);
      return res.status(200).json(toPublicUser(user));
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
      const washerStatus = await storage.getWasherBgCheckStatus(userId);
      const isCleared = washerStatus?.bgCheckStatus === 'cleared';
      if (isCleared) {
        filtered = filtered.filter(o => o.status === 'pending' || o.washerId === userId);
      } else {
        filtered = filtered.filter(o => o.washerId === userId);
      }
    }

    if (status) {
      filtered = filtered.filter(o => o.status === status);
    }

    return res.status(200).json(filtered.map(o => {
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
      if (!user.customerUnlockedAt) {
        // Reconcile with Stripe here as well as on GET /api/customer-unlock so
        // a payment that completed after the checkout UI closed cannot leave a
        // legitimately paid customer unable to place their first order.
        const unlocked = await unlockService().status(userId);
        if (!unlocked) {
          return res.status(402).json({
            message: "Pay the one-time $2.99 unlock fee before placing an order",
            code: "CUSTOMER_UNLOCK_REQUIRED",
          });
        }
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

      void notifyClearedWashersOfNewOrder(order.id);
      return res.status(201).json(sanitizeOrder(order));
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

      const washerStatus = await storage.getWasherBgCheckStatus(userId);
      if (!washerStatus || washerStatus.bgCheckStatus !== 'cleared') {
        return res.status(403).json({ message: "You must complete the background check verification before claiming jobs." });
      }

      const order = await storage.claimOrder(parseInt(req.params.id), userId);
      void notifyOrderStatusChange({
        customerId: order.customerId,
        orderId: order.id,
        status: 'accepted',
      });
      return res.status(200).json(sanitizeOrder(order));
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
      return res.status(404).json({ message: "Order not found" });
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

      const washerStatus = await storage.getWasherBgCheckStatus(userId);
      if (!washerStatus || washerStatus.bgCheckStatus !== 'cleared') {
        return res.status(403).json({ message: "Your background check verification is required to access customer addresses." });
      }

      const order = await storage.getOrder(orderId);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (!order.washerId || order.washerId !== userId) {
        return res.status(403).json({ message: "You are not assigned to this order" });
      }

      const activeStatuses = ['accepted', 'picked_up', 'in_progress', 'out_for_delivery'];
      if (!activeStatuses.includes(order.status)) {
        return res.status(403).json({ message: "Customer address is only available for active orders" });
      }

      if (!order.pickupAddress) {
        return res.status(404).json({ message: "Customer address not found" });
      }

      return res.status(200).json({ address: order.pickupAddress });
    } catch {
      return res.status(404).json({ message: "Order not found" });
    }
  });

  // Customer-visible order lifecycle: each transition triggers a push notification.
  const ALLOWED_STATUS_TRANSITIONS: Record<string, string> = {
    accepted: 'picked_up',
    picked_up: 'in_progress',
    in_progress: 'out_for_delivery',
    out_for_delivery: 'completed',
  };

  app.patch(api.orders.updateStatus.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);

      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only active washers can update order status" });
      }

      const washerStatus = await storage.getWasherBgCheckStatus(userId);
      if (!washerStatus || washerStatus.bgCheckStatus !== 'cleared') {
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
      void notifyOrderStatusChange({
        customerId: updated.customerId,
        orderId: updated.id,
        status: input.status,
      });
      return res.status(200).json(sanitizeOrder(updated));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      return res.status(404).json({ message: "Order not found" });
    }
  });

  app.get(api.washerProfile.get.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const profile = await storage.getWasherProfile(userId);
    if (!profile) {
      return res.status(404).json({ message: "Washer profile not found" });
    }
    return res.status(200).json(maskWasherProfile(profile));
  });

  app.get(api.washerProfile.status.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const status = await storage.getWasherBgCheckStatus(userId);
    if (!status) {
      return res.status(404).json({ message: "Washer profile not found" });
    }
    // Non-sensitive screening state for the washer's own UI: authorization
    // state (so the UI can prompt re-authorization) and adverse-action
    // waiting info. Never expose report details or evidence IPs.
    const profile = await storage.getWasherProfile(userId);
    const waitDays = getAdverseActionWaitDays();
    const adverse = await storage.getAdverseActionInfo(userId, waitDays);
    return res.status(200).json({
      ...status,
      fcraAuthorized: isFcraAuthorized(profile),
      fcraDisclosureVersion: profile?.fcraDisclosureVersion ?? null,
      fcraDisclosureCurrent: FCRA_DISCLOSURE_VERSION,
      adverseAction: adverse && (adverse.bgCheckStatus === "pre_adverse_action" || adverse.bgCheckStatus === "adverse_action_final")
        ? {
            status: adverse.bgCheckStatus,
            preAdverseSentAt: adverse.preAdverseSentAt,
            waitDays: adverse.waitDays,
            remainingBusinessDays: adverse.readiness.remainingBusinessDays,
          }
        : null,
    });
  });

  // Screening decisions are deliberately not part of the washer profile API.
  // Only operators listed in WASHMATE_ADMIN_USER_IDS may record a provider
  // outcome, and storage re-checks consent, current state, and the audit write
  // inside one transaction.
  app.post('/api/admin/washer-screening/:userId/decision', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    try {
      const input = washerScreeningDecisionSchema.parse(req.body);
      const profile = await storage.transitionWasherBgCheck(req.params.userId, {
        ...input,
        actorId: operatorId,
      });
      return res.status(200).json({ userId: profile.userId, bgCheckStatus: profile.bgCheckStatus });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      if (err?.message === 'WASHER_PROFILE_NOT_FOUND') {
        return res.status(404).json({ message: "Washer profile not found" });
      }
      if (err?.message === 'BG_CHECK_CONSENT_REQUIRED') {
        return res.status(409).json({ message: "Washer screening consent and required information are no longer complete." });
      }
      if (err?.message === 'BG_CHECK_NOT_PENDING') {
        return res.status(409).json({ message: "Only a pending screening can receive a provider decision." });
      }
      throw err;
    }
  });

  // Adverse-action workflow (admin only).
  //
  // Mechanics, NOT legal advice: when a report comes back "consider", the
  // washer is `flagged`. Before any final adverse decision, federal guidance
  // describes a pre-adverse notice (report copy + Summary of Rights + time to
  // respond), a waiting period, then a final notice. This code enforces the
  // sequence and the waiting period server-side and audits every step. It
  // does NOT make WashMate compliant — employment counsel must review the
  // templates, waiting period, and process before live use.
  //
  // Notice DELIVERY (email/mail to the washer) is an operational step the
  // admin completes outside this endpoint; the generated notice text is
  // returned here and its version + timestamp are recorded in the database.
  function handleAdverseActionError(err: any, res: any) {
    if (err?.message === "WASHER_PROFILE_NOT_FOUND") {
      return res.status(404).json({ message: "Washer profile not found" });
    }
    if (err?.message === "ADVERSE_ACTION_TRANSITION_NOT_ALLOWED") {
      return res.status(409).json({ message: "This adverse-action step is not allowed from the washer's current status." });
    }
    if (err?.message === "ADVERSE_ACTION_WAIT_NOT_ELAPSED") {
      return res.status(409).json({
        message: `The waiting period has not elapsed. ${err.remainingBusinessDays ?? "?"} business day(s) remain.`,
        remainingBusinessDays: err.remainingBusinessDays ?? null,
      });
    }
    throw err;
  }

  function formatNoticeDate(d: Date): string {
    return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  }

  // Step 1: send the pre-adverse notice. Requires status `flagged`.
  // Fail-closed: refuses when FCRA business details are still placeholders,
  // so a notice can never go out addressed from "[BUSINESS NAME]".
  app.post('/api/admin/washer-screening/:userId/pre-adverse', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    try {
      const details = getFcraBusinessDetails();
      if (!details.isConfigured) {
        return res.status(409).json({
          message: "Configure FCRA_BUSINESS_NAME, FCRA_BUSINESS_ADDRESS, and FCRA_BUSINESS_PHONE before generating adverse-action notices.",
        });
      }
      const waitDays = getAdverseActionWaitDays();
      const profile = await storage.transitionAdverseAction(req.params.userId, {
        toStatus: "pre_adverse_action",
        actorId: operatorId,
        reasonCode: "pre_adverse_notice_sent",
        noticeVersion: FCRA_NOTICE_VERSION,
        waitDays,
      });
      const sentAt = new Date();
      const notice = renderPreAdverseNotice({
        businessName: details.businessName,
        businessAddress: details.businessAddress,
        businessPhone: details.businessPhone,
        craName: details.craName,
        craAddress: details.craAddress,
        craPhone: details.craPhone,
        candidateName: profile.legalName || "Applicant",
        noticeDate: formatNoticeDate(sentAt),
        responseDeadline: formatNoticeDate(addBusinessDays(sentAt, waitDays)),
      });
      return res.status(200).json({
        userId: profile.userId,
        bgCheckStatus: profile.bgCheckStatus,
        preAdverseSentAt: profile.preAdverseSentAt,
        waitBusinessDays: waitDays,
        noticeVersion: FCRA_NOTICE_VERSION,
        cfpRightsUrl: CFPB_RIGHTS_URL,
        notice,
        deliveryNote: "Deliver this notice to the washer along with a copy of the Checkr report. Delivery is an operational step outside this endpoint.",
      });
    } catch (err: any) {
      return handleAdverseActionError(err, res);
    }
  });

  // Step 2: record the final adverse decision. Requires status
  // `pre_adverse_action` AND the waiting period to have elapsed (enforced
  // server-side in business days).
  app.post('/api/admin/washer-screening/:userId/adverse-final', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    try {
      const details = getFcraBusinessDetails();
      if (!details.isConfigured) {
        return res.status(409).json({
          message: "Configure FCRA_BUSINESS_NAME, FCRA_BUSINESS_ADDRESS, and FCRA_BUSINESS_PHONE before generating adverse-action notices.",
        });
      }
      const waitDays = getAdverseActionWaitDays();
      const profile = await storage.transitionAdverseAction(req.params.userId, {
        toStatus: "adverse_action_final",
        actorId: operatorId,
        reasonCode: "adverse_action_final",
        noticeVersion: FCRA_NOTICE_VERSION,
        waitDays,
      });
      const notice = renderAdverseActionNotice({
        businessName: details.businessName,
        businessAddress: details.businessAddress,
        businessPhone: details.businessPhone,
        craName: details.craName,
        craAddress: details.craAddress,
        craPhone: details.craPhone,
        candidateName: profile.legalName || "Applicant",
        noticeDate: formatNoticeDate(new Date()),
      });
      return res.status(200).json({
        userId: profile.userId,
        bgCheckStatus: profile.bgCheckStatus,
        adverseActionFinalAt: profile.adverseActionFinalAt,
        noticeVersion: FCRA_NOTICE_VERSION,
        cfpRightsUrl: CFPB_RIGHTS_URL,
        notice,
        deliveryNote: "Deliver this notice to the washer. Delivery is an operational step outside this endpoint.",
      });
    } catch (err: any) {
      return handleAdverseActionError(err, res);
    }
  });

  // Dispute resolution: a flagged (or pre-adverse) washer whose dispute
  // resolves favorably can be cleared by an admin with an explicit reason.
  // This is the only path out of pre_adverse_action other than the final
  // adverse decision; adverse_action_final is terminal and never regresses.
  app.post('/api/admin/washer-screening/:userId/clear-dispute', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    try {
      const profile = await storage.transitionAdverseAction(req.params.userId, {
        toStatus: "cleared",
        actorId: operatorId,
        reasonCode: "dispute_resolved",
      });
      return res.status(200).json({ userId: profile.userId, bgCheckStatus: profile.bgCheckStatus });
    } catch (err: any) {
      return handleAdverseActionError(err, res);
    }
  });

  app.post('/api/admin/washer-screening/:userId/resubmit', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    try {
      const profile = await storage.resubmitWasherBgCheck(req.params.userId, operatorId);
      // Best-effort: a resubmission should re-screen via Checkr, not strand
      // the washer in pending. Never fails the resubmit itself.
      if (getCheckrConfig() && profile.state) {
        try {
          const clerkUser = await clerkClient.users.getUser(req.params.userId).catch(() => null);
          const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
          if (email) {
            await startWasherScreening({ userId: req.params.userId, email, state: profile.state });
          }
        } catch (err) {
          req.log?.error({ err, userId: req.params.userId }, "Failed to start Checkr screening on resubmit");
        }
      }
      return res.status(200).json({ userId: profile.userId, bgCheckStatus: profile.bgCheckStatus });
    } catch (err: any) {
      if (err?.message === 'WASHER_PROFILE_NOT_FOUND') {
        return res.status(404).json({ message: "Washer profile not found" });
      }
      if (err?.message === 'BG_CHECK_CONSENT_REQUIRED') {
        return res.status(409).json({ message: "Washer screening consent and required information are no longer complete." });
      }
      if (err?.message === 'BG_CHECK_NOT_RESUBMITTABLE') {
        return res.status(409).json({ message: "Only a flagged or provider-failed screening can be resubmitted." });
      }
      throw err;
    }
  });

  app.get('/api/admin/washer-screening/:userId/events', isAuthenticated, async (req: any, res) => {
    const operatorId = getUserId(req);
    if (!isAdmin(operatorId)) return res.status(403).json({ message: "Admin only" });
    const events = await storage.getWasherBgCheckEvents(req.params.userId);
    return res.status(200).json(events);
  });

  // Best-effort Checkr screening start after a fresh submission. Never fails
  // the caller's request: if Checkr is unconfigured or errors, the screening
  // stays pending for an operator decision or a resend.
  async function maybeStartCheckrScreening(userId: string, profile: { state: string | null }, req: any) {
    if (!getCheckrConfig()) return;
    try {
      const clerkUser = await clerkClient.users.getUser(userId).catch(() => null);
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
      if (email && profile.state) {
        await startWasherScreening({ userId, email, state: profile.state });
      } else {
        req.log?.warn(
          { userId },
          "Skipping Checkr screening start: missing washer email or state",
        );
      }
    } catch (err) {
      req.log?.error({ err, userId }, "Failed to start Checkr screening; left pending");
    }
  }

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

      const profile = await storage.upsertWasherProfile(
        { ...profileData, userId },
        // Capture the client IP at the trusted proxy boundary so ToS
        // acceptance evidence is recorded when the washer agrees.
        { clientIp: resolveClientIp(req) },
      );

      // A fresh screening submission (not_started → pending) kicks off the
      // Checkr background check via the hosted invitation flow. This never
      // fails the profile save: if Checkr is unconfigured or errors, the
      // screening stays pending for an operator decision or a resend.
      const newScreeningSubmission =
        (!existing || existing.bgCheckStatus === "not_started") &&
        profile.bgCheckStatus === "pending";
      if (newScreeningSubmission) {
        await maybeStartCheckrScreening(userId, profile, req);
      }
      return res.status(200).json(maskWasherProfile(profile));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message, field: err.errors[0].path.join('.') });
      }
      throw err;
    }
  });

  // Standalone FCRA disclosure text. This endpoint exists so the disclosure is
  // served from one versioned source of truth and shown on its own screen —
  // never bundled with other consents or terms. The text is a TEMPLATE that
  // must be customized and reviewed by employment counsel before live use.
  app.get("/api/washer/screening/fcra-disclosure", isAuthenticated, async (req: any, res) => {
    const details = getFcraBusinessDetails();
    return res.status(200).json({
      version: FCRA_DISCLOSURE_VERSION,
      text: renderFcraDisclosureText({
        businessName: details.businessName,
        businessAddress: details.businessAddress,
        businessPhone: details.businessPhone,
        craName: details.craName,
      }),
    });
  });

  // Record the washer's separate written FCRA authorization. This is a
  // distinct, explicit act — not part of the profile form — and is recorded
  // server-side with timestamp + client IP + disclosure version. Idempotent:
  // re-authorizing under the current version only re-evaluates submission.
  // When the profile is otherwise complete, authorizing also submits the
  // screening (not_started → pending) and kicks off the Checkr invitation.
  app.post("/api/washer/screening/fcra-authorize", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== "washer") {
        return res.status(403).json({ message: "Only washers can authorize screening" });
      }
      const parsed = z.object({ authorized: z.literal(true) }).safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Authorization must be explicitly confirmed." });
      }
      const before = await storage.getWasherProfile(userId);
      if (!before) {
        return res.status(404).json({ message: "Washer profile not found. Save your profile first." });
      }
      const profile = await storage.recordFcraAuthorization(userId, {
        ip: resolveClientIp(req) ?? null,
        version: FCRA_DISCLOSURE_VERSION,
      });
      if (before.bgCheckStatus === "not_started" && profile.bgCheckStatus === "pending") {
        await maybeStartCheckrScreening(userId, profile, req);
      }
      return res.status(200).json({
        authorized: true,
        version: profile.fcraDisclosureVersion,
        authorizedAt: profile.fcraAuthorizedAt,
        bgCheckStatus: profile.bgCheckStatus,
      });
    } catch (err: any) {
      if (err?.message === "WASHER_PROFILE_NOT_FOUND") {
        return res.status(404).json({ message: "Washer profile not found. Save your profile first." });
      }
      throw err;
    }
  });

  // Resend (or first-send) the Checkr screening invitation for the caller's
  // own pending screening — e.g. after the invitation email was missed or
  // expired. This only ever *requests* a screening; it can never decide one.
  // Status transitions happen exclusively via the verified Checkr webhook or
  // an admin operator action.
  app.post("/api/washer/screening/resend-invitation", isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const profile = await storage.getWasherProfile(userId);
      if (!profile) {
        return res.status(404).json({ message: "Washer profile not found" });
      }
      if (profile.bgCheckStatus !== "pending") {
        return res.status(409).json({ message: "Only a pending screening can be resent." });
      }
      if (!getCheckrConfig()) {
        return res.status(503).json({ message: "Screening provider is not configured." });
      }
      const clerkUser = await clerkClient.users.getUser(userId).catch(() => null);
      const email = clerkUser?.emailAddresses?.[0]?.emailAddress;
      if (!email || !profile.state) {
        return res.status(409).json({ message: "Email and state are required to start screening." });
      }
      const result = await startWasherScreening({ userId, email, state: profile.state });
      return res.status(200).json({
        invitationSent: !result.invitationReused,
        message: result.invitationReused
          ? "Your screening invitation is still active — check your email."
          : "Screening invitation sent — check your email to complete it.",
      });
    } catch (err: any) {
      req.log?.error({ err }, "Failed to resend Checkr screening invitation");
      if (err?.message === "CHECKR_INVALID_STATE") {
        return res.status(409).json({ message: "A valid 2-letter state is required to start screening." });
      }
      if (err?.message === "FCRA_AUTHORIZATION_MISSING") {
        return res.status(409).json({
          message: "Complete the background check disclosure and authorization first.",
          code: "FCRA_AUTHORIZATION_MISSING",
        });
      }
      return res.status(502).json({ message: "Could not reach the screening provider. Please try again." });
    }
  });

  // Stripe Financial Connections — create a session so the washer can verify
  // a bank account through Stripe's hosted UI. Returns the client secret used
  // by Stripe.js on the frontend, plus the publishable key so the browser can
  // construct its Stripe instance without a separate round-trip.
  app.post(api.washerProfile.fcSession.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only washers can verify a bank account" });
      }
      const profile = await storage.getWasherProfile(userId);
      if (!profile) {
        return res.status(400).json({
          message: "Save your washer profile basics before verifying a bank account.",
        });
      }

      const stripe = await getUncachableStripeClient();

      // Get-or-create a Stripe customer scoped to this washer. Customers are
      // server-controlled — never trust a client-supplied customer id.
      let customerId = profile.stripeCustomerId;
      if (!customerId) {
        const clerkUser = await clerkClient.users.getUser(userId).catch(() => null);
        const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? undefined;
        const customer = await stripe.customers.create({
          email,
          metadata: { washmateUserId: userId },
        });
        customerId = customer.id;
        await storage.setStripeCustomerId(userId, customerId);
      }

      const session = await stripe.financialConnections.sessions.create({
        account_holder: { type: "customer", customer: customerId },
        permissions: ["payment_method", "balances"],
        filters: { countries: ["US"] },
      });

      const publishableKey = await getStripePublishableKey();

      return res.status(200).json({
        clientSecret: session.client_secret,
        publishableKey,
      });
    } catch (err: any) {
      req.log?.error({ err }, "Failed to create Financial Connections session");
      return res.status(500).json({
        message: "Something went wrong starting Stripe verification — please try again",
      });
    }
  });

  // Stripe Financial Connections — finalize verification after the washer
  // completes the Stripe modal on the client. We re-fetch the session from
  // Stripe (never trust the client) and require it to belong to this washer's
  // Stripe customer before persisting the linked account info.
  app.post(api.washerProfile.fcComplete.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only washers can verify a bank account" });
      }
      const { sessionId } = api.washerProfile.fcComplete.input.parse(req.body);

      const profile = await storage.getWasherProfile(userId);
      if (!profile || !profile.stripeCustomerId) {
        return res.status(404).json({ message: "Washer profile or Stripe customer not found" });
      }

      const stripe = await getUncachableStripeClient();
      const session = await stripe.financialConnections.sessions.retrieve(sessionId, {
        expand: ["accounts"],
      });

      // Authorization: the session's account_holder.customer must match our
      // server-stored customer id for this washer. Without this check, any
      // authenticated user could attach another washer's verified bank.
      const holder = session.account_holder;
      if (!holder || holder.type !== "customer" || holder.customer !== profile.stripeCustomerId) {
        return res.status(403).json({ message: "Verification session does not belong to your account" });
      }

      const account = session.accounts?.data?.[0];
      if (!account) {
        return res.status(400).json({ message: "No bank account was linked. Please try again." });
      }

      const updated = await storage.attachStripeBankAccount(userId, {
        stripeBankAccountId: account.id,
        verifiedBankName: account.institution_name ?? null,
        verifiedAccountLast4: account.last4 ?? null,
      });

      // Best-effort: provision the washer's Connect Custom account up front so
      // the first payout request goes through without an extra round-trip to
      // Stripe. If this fails (test-mode KYC quirks, etc.) we don't block the
      // verification — executePayout() will retry it at payout time.
      ensureConnectAccount(userId, { clientIp: resolveClientIp(req) }).catch((err) => {
        req.log?.warn({ err }, "ensureConnectAccount failed during FC complete (will retry on payout)");
      });

      return res.status(200).json(maskWasherProfile(updated));
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      req.log?.error({ err }, "Failed to complete Financial Connections session");
      return res.status(500).json({
        message: "Something went wrong verifying your bank account — please try again",
      });
    }
  });

  // Washer earnings — current unpaid balance + payout history. Visible only
  // to the washer themselves; we never expose another washer's earnings.
  app.get(api.washerProfile.earnings.path, isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    const user = await storage.getUser(userId);
    if (!user || user.role !== 'washer') {
      return res.status(403).json({ message: "Only washers have earnings" });
    }
    const profile = await storage.getWasherProfile(userId);
    const summary = await storage.getWasherEarnings(userId);
    return res.status(200).json({
      unpaidEarningsCents: summary.unpaidEarningsCents,
      unpaidPlatformFeeCents: summary.unpaidPlatformFeeCents,
      unpaidOrderCount: summary.unpaidOrderCount,
      hasVerifiedBank: !!profile?.stripeBankAccountId,
      verifiedBankName: profile?.verifiedBankName ?? null,
      verifiedAccountLast4: profile?.verifiedAccountLast4 ?? null,
      payouts: summary.payouts.map(p => ({
        id: p.id,
        amountCents: p.amountCents,
        platformFeeCents: p.platformFeeCents,
        totalFeeCents: p.totalFeeCents,
        orderCount: p.orderCount,
        status: p.status,
        verifiedBankName: p.verifiedBankName,
        verifiedAccountLast4: p.verifiedAccountLast4,
        failureReason: p.failureReason ? WASHER_PAYOUT_FAILURE_REASON : null,
        createdAt: p.createdAt,
        paidAt: p.paidAt,
      })),
    });
  });

  // Washer-initiated payout. Rolls all unpaid completed orders into a single
  // payout record, then immediately triggers the Stripe transfer + payout to
  // their verified bank. The local row stays `pending` until Stripe confirms
  // bank settlement via the `payout.paid` / `payout.failed` webhook (or until
  // an admin reconciles it manually).
  app.post(api.washerProfile.requestPayout.path, isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const user = await storage.getUser(userId);
      if (!user || user.role !== 'washer') {
        return res.status(403).json({ message: "Only washers can request a payout" });
      }
      const payout = await storage.requestPayout(userId);
      try {
        await executePayout(payout.id, { clientIp: resolveClientIp(req) });
      } catch (err: any) {
        // executePayout has already marked the payout failed (and released its
        // orders) when it throws, so the database stays consistent. Surface a
        // 502 so the client knows the request didn't actually move money.
        if (err instanceof PayoutError && err.code === "TOS_EVIDENCE_MISSING") {
          return res.status(400).json({ message: err.message });
        }
        req.log?.error({ err, payoutId: payout.id }, "executePayout failed");
        return res.status(502).json({ message: "Payout could not be sent to your bank. Please try again." });
      }
      const finalPayout = await storage.getPayout(payout.id) ?? payout;
      return res.status(201).json({
        id: finalPayout.id,
        amountCents: finalPayout.amountCents,
        orderCount: finalPayout.orderCount,
        status: finalPayout.status,
      });
    } catch (err: any) {
      if (err?.message === 'NO_VERIFIED_BANK') {
        return res.status(400).json({ message: "Verify a bank account before requesting a payout." });
      }
      if (err?.message === 'NO_UNPAID_EARNINGS') {
        return res.status(400).json({ message: "You have no unpaid earnings to pay out right now." });
      }
      if (err?.message === 'WASHER_PROFILE_NOT_FOUND') {
        return res.status(404).json({ message: "Washer profile not found" });
      }
      throw err;
    }
  });

  // Admin/automated trigger — pays out every washer with unpaid earnings.
  // Gated by WASHMATE_ADMIN_USER_IDS (comma-separated Clerk user ids). This
  // is the entrypoint a scheduled job (cron, Replit Scheduled Deployment)
  // would hit on a daily cadence.
  app.post('/api/admin/payouts/process-all', isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!isAdmin(userId)) {
      return res.status(403).json({ message: "Admin only" });
    }
    const washerIds = await storage.listWasherIdsWithUnpaidEarnings();
    const results: Array<{ washerId: string; payoutId?: number; status: string; error?: string }> = [];
    for (const washerId of washerIds) {
      try {
        const payout = await storage.requestPayout(washerId);
        try {
          await executePayout(payout.id);
          const final = await storage.getPayout(payout.id);
          results.push({ washerId, payoutId: payout.id, status: final?.status ?? 'pending' });
        } catch (err: any) {
          results.push({ washerId, payoutId: payout.id, status: 'failed', error: err?.message ?? String(err) });
        }
      } catch (err: any) {
        // NO_VERIFIED_BANK / NO_UNPAID_EARNINGS / etc. — skip with a note.
        results.push({ washerId, status: 'skipped', error: err?.message ?? String(err) });
      }
    }
    return res.status(200).json({ processed: results.length, results });
  });

  // Admin manual reconciliation — flip a `pending` payout to paid/failed.
  // Useful when the webhook is not configured or for one-off corrections.
  app.post('/api/admin/payouts/:id/mark-paid', isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!isAdmin(userId)) return res.status(403).json({ message: "Admin only" });
    const payoutId = Number(req.params.id);
    if (!Number.isInteger(payoutId)) return res.status(400).json({ message: "Invalid payout id" });
    try {
      const updated = await storage.markPayoutPaid(payoutId, req.body?.stripePayoutId ?? null);
      return res.status(200).json({ id: updated.id, status: updated.status });
    } catch (err: any) {
      if (err?.message === 'PAYOUT_NOT_PENDING') return res.status(409).json({ message: "Payout is not pending" });
      throw err;
    }
  });
  app.post('/api/admin/payouts/:id/mark-failed', isAuthenticated, async (req: any, res) => {
    const userId = getUserId(req);
    if (!isAdmin(userId)) return res.status(403).json({ message: "Admin only" });
    const payoutId = Number(req.params.id);
    if (!Number.isInteger(payoutId)) return res.status(400).json({ message: "Invalid payout id" });
    const reason = String(req.body?.reason ?? "Marked failed by admin");
    try {
      const updated = await storage.markPayoutFailed(payoutId, reason);
      return res.status(200).json({ id: updated.id, status: updated.status });
    } catch (err: any) {
      if (err?.message === 'PAYOUT_NOT_PENDING') return res.status(409).json({ message: "Payout is not pending" });
      throw err;
    }
  });

  // Register an Expo push token for the logged-in user (called from the iOS WebView wrapper).
  const deviceTokenSchema = z.object({
    token: z.string().min(1),
    platform: z.enum(['ios', 'android', 'web']).optional(),
  });

  app.post('/api/device-tokens', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const input = deviceTokenSchema.parse(req.body);
      await registerDeviceToken(userId, input.token, input.platform ?? 'ios');
      return res.status(204).end();
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      if (err?.message === 'INVALID_PUSH_TOKEN') {
        return res.status(400).json({ message: 'Invalid push token format' });
      }
      throw err;
    }
  });

  const deleteTokenSchema = z.object({ token: z.string().min(1) });

  app.delete('/api/device-tokens', isAuthenticated, async (req: any, res) => {
    try {
      const userId = getUserId(req);
      const { token } = deleteTokenSchema.parse(req.body);
      await unregisterDeviceToken(userId, token);
      return res.status(204).end();
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: err.errors[0].message });
      }
      throw err;
    }
  });

  return httpServer;
}
