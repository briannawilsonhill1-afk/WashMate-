import type { Express, Request, Response } from "express";
import express from "express";
import { getUncachableStripeClient } from "../stripeClient";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { reconcileIncidentPayout } from "../incidents";
import { WASHER_PAYOUT_FAILURE_REASON } from "../payoutService";

// Stripe-signed webhook for payout settlement and Financial Connections
// lifecycle events. The signature is verified against STRIPE_WEBHOOK_SECRET;
// without that secret configured the endpoint refuses all events to prevent
// forged updates.
//
// Mounted BEFORE express.json() so we can read the raw body for signature
// verification. The path is namespaced under /api/stripe/webhook.
export function mountStripeWebhook(app: Express) {
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const secret = process.env["STRIPE_WEBHOOK_SECRET"];
      if (!secret) {
        logger.warn("Received Stripe webhook but STRIPE_WEBHOOK_SECRET is not set; rejecting");
        return res.status(503).json({ message: "Webhook not configured" });
      }
      const sig = req.headers["stripe-signature"];
      if (typeof sig !== "string") {
        return res.status(400).json({ message: "Missing stripe-signature" });
      }

      let event;
      try {
        const stripe = await getUncachableStripeClient();
        event = stripe.webhooks.constructEvent(req.body as Buffer, sig, secret);
      } catch (err: any) {
        logger.warn({ err }, "Stripe webhook signature verification failed");
        return res.status(400).json({ message: "Invalid signature" });
      }

      try {
        if (
          event.type === "financial_connections.account.deactivated" ||
          event.type === "financial_connections.account.disconnected"
        ) {
          const account = event.data.object as { id: string };
          const clearedCount = await storage.clearStripeBankAccount(account.id);
          logger.info(
            { stripeBankAccountId: account.id, eventType: event.type, clearedCount },
            "Cleared disconnected Financial Connections account",
          );
        }

        if (event.type === "payout.paid" || event.type === "payout.failed") {
          if (await reconcileIncidentPayout(event)) return res.status(200).json({received: true});
          const stripePayout = event.data.object as {
            id: string;
            failure_message?: string | null;
            metadata?: Record<string, string> | null;
          };
          // Reconcile only deterministic identifiers. A Connect account may
          // have several pending payouts, so account ownership or row recency
          // is never sufficient to choose one.
          let local = await storage.findPendingPayoutByStripePayoutId(stripePayout.id);
          const connectAccountId = (event as any).account as string | undefined;
          if (!local && stripePayout.metadata?.["washmatePayoutId"]) {
            const id = Number(stripePayout.metadata["washmatePayoutId"]);
            if (Number.isInteger(id)) {
              const candidate = await storage.getPayout(id);
              if (
                candidate?.status === "pending" &&
                (!candidate.stripePayoutId || candidate.stripePayoutId === stripePayout.id) &&
                (!connectAccountId || candidate.stripeConnectAccountId === connectAccountId)
              ) {
                local = candidate;
              }
            }
          }
          if (local && connectAccountId && local.stripeConnectAccountId !== connectAccountId) {
            logger.warn(
              { payoutId: local.id, stripePayoutId: stripePayout.id, connectAccountId },
              "Ignored Stripe payout event with mismatched Connect account",
            );
            local = undefined;
          }
          if (!local) {
            logger.info({ stripePayoutId: stripePayout.id, type: event.type, connectAccountId }, "No matching pending payout for webhook (already reconciled?)");
            return res.status(200).json({ received: true });
          }
          // Backfill stripePayoutId so subsequent events for the same payout
          // can be looked up by id (the fast path).
          if (!local.stripePayoutId) {
            const attached = await storage.attachStripePayoutId(local.id, stripePayout.id);
            if (!attached) {
              logger.warn(
                { payoutId: local.id, stripePayoutId: stripePayout.id },
                "Ignored Stripe payout event after a different payout was attached",
              );
              return res.status(200).json({ received: true });
            }
          }
          if (event.type === "payout.paid") {
            await storage.markPayoutPaid(local.id, stripePayout.id);
          } else {
            logger.error(
              {
                payoutId: local.id,
                stripePayoutId: stripePayout.id,
                failureMessage: stripePayout.failure_message,
              },
              "Stripe payout failed",
            );
            await storage.markPayoutFailed(local.id, WASHER_PAYOUT_FAILURE_REASON);
          }
        }
        return res.status(200).json({ received: true });
      } catch (err: any) {
        logger.error({ err, eventType: event.type }, "Failed to process Stripe webhook");
        return res.status(500).json({ message: "Internal error processing webhook" });
      }
    },
  );
}
