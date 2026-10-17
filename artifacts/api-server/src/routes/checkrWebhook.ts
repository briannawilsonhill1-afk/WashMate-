import type { Express, Request, Response } from "express";
import express from "express";
import { storage } from "../storage";
import { getCheckrConfig, verifyCheckrSignature } from "../lib/checkr";
import { logger } from "../lib/logger";
import type { WasherBgCheckDecision } from "../storage";

// Checkr-signed webhook for background-check report lifecycle events.
// Signature is verified with HMAC-SHA256 against CHECKR_WEBHOOK_SECRET
// (falling back to CHECKR_API_KEY); without a configured secret the endpoint
// refuses all events so forged deliveries can never move a screening.
//
// Mounted BEFORE express.json() so we can read the raw body for signature
// verification. The path is namespaced under /api/webhooks/checkr.

interface CheckrReportObject {
  id?: string;
  candidate_id?: string;
  status?: string;
}

interface CheckrInvitationObject {
  id?: string;
  candidate_id?: string;
  status?: string;
}

interface CheckrEvent {
  id?: string;
  type?: string;
  data?: { object?: CheckrReportObject & CheckrInvitationObject };
}

function mapReportOutcome(status: string | undefined): {
  toStatus: WasherBgCheckDecision;
  result: "clear" | "consider" | "suspended";
  reasonCode: "provider_cleared" | "provider_flagged" | "provider_failed";
} | null {
  switch (status) {
    case "clear":
      return { toStatus: "cleared", result: "clear", reasonCode: "provider_cleared" };
    case "consider":
      return { toStatus: "flagged", result: "consider", reasonCode: "provider_flagged" };
    case "suspended":
      // Checkr could not complete the report — treat as a provider failure
      // so the washer can be resubmitted rather than stranded in pending.
      return { toStatus: "provider_failed", result: "suspended", reasonCode: "provider_failed" };
    default:
      return null;
  }
}

export function mountCheckrWebhook(app: Express) {
  app.post(
    "/api/webhooks/checkr",
    express.raw({ type: "application/json" }),
    async (req: Request, res: Response) => {
      const config = getCheckrConfig();
      if (!config) {
        logger.warn("Received Checkr webhook but CHECKR_API_KEY is not set; rejecting");
        return res.status(503).json({ message: "Webhook not configured" });
      }
      const sigHeader = req.get("x-checkr-signature") ?? req.get("checkr-signature");
      if (
        !verifyCheckrSignature(req.body as Buffer, sigHeader, config.webhookSecrets)
      ) {
        logger.warn("Checkr webhook signature verification failed");
        return res.status(400).json({ message: "Invalid signature" });
      }

      let event: CheckrEvent;
      try {
        event = JSON.parse((req.body as Buffer).toString("utf8"));
      } catch {
        return res.status(400).json({ message: "Invalid JSON body" });
      }
      if (!event || typeof event.type !== "string") {
        return res.status(400).json({ message: "Missing event type" });
      }

      try {
        if (event.type === "report.completed") {
          const report = event.data?.object ?? {};
          const outcome = mapReportOutcome(report.status);
          if (!report.id || !report.candidate_id || !outcome) {
            logger.warn(
              { eventId: event.id, status: report.status },
              "Checkr report.completed event missing id, candidate, or usable status; ignoring",
            );
            return res.status(200).json({ received: true });
          }

          const profile = await storage.getWasherProfileByCheckrCandidateId(report.candidate_id);
          if (!profile) {
            // Unknown candidate — acknowledge so Checkr stops retrying; there
            // is nothing local to reconcile.
            logger.warn(
              { checkrCandidateId: report.candidate_id, reportId: report.id },
              "Checkr report event for unknown candidate; ignoring",
            );
            return res.status(200).json({ received: true });
          }

          // Idempotency: the same report delivered twice must not double-apply.
          if (profile.checkrReportId === report.id) {
            logger.info(
              { userId: profile.userId, reportId: report.id },
              "Duplicate Checkr report event; already processed",
            );
            return res.status(200).json({ received: true });
          }

          // Never regress a decided screening: only pending screenings accept
          // a provider decision. Out-of-order or stale events are ignored.
          if (profile.bgCheckStatus !== "pending") {
            logger.warn(
              { userId: profile.userId, bgCheckStatus: profile.bgCheckStatus, reportId: report.id },
              "Checkr report event for non-pending screening; ignoring",
            );
            return res.status(200).json({ received: true });
          }

          try {
            const updated = await storage.transitionWasherBgCheck(profile.userId, {
              toStatus: outcome.toStatus,
              actorType: "provider",
              actorId: "checkr",
              providerReference: report.id,
              reasonCode: outcome.reasonCode,
              decision: { result: outcome.result, reportId: report.id },
            });
            logger.info(
              { userId: profile.userId, reportId: report.id, toStatus: updated.bgCheckStatus },
              "Washer screening decided by Checkr report",
            );
          } catch (err: any) {
            if (err?.message === "BG_CHECK_NOT_PENDING") {
              // Lost a race with another decision; the first one won.
              logger.info(
                { userId: profile.userId, reportId: report.id },
                "Checkr report event arrived after screening was already decided",
              );
              return res.status(200).json({ received: true });
            }
            throw err;
          }
          return res.status(200).json({ received: true });
        }

        if (event.type === "invitation.expired") {
          const invitation = event.data?.object ?? {};
          if (invitation.candidate_id && invitation.id) {
            const profile = await storage.getWasherProfileByCheckrCandidateId(
              invitation.candidate_id,
            );
            if (profile) {
              // Only unstick a still-pending screening whose stored invitation
              // matches; decided screenings are never touched.
              const cleared = await storage.clearCheckrInvitation(profile.userId, invitation.id);
              logger.info(
                { userId: profile.userId, invitationId: invitation.id, cleared },
                "Checkr invitation expired",
              );
            }
          }
          return res.status(200).json({ received: true });
        }

        // All other event types (invitation.created/completed, report.created,
        // report.upgraded, etc.) carry no decision — acknowledge and ignore.
        logger.info({ eventType: event.type, eventId: event.id }, "Ignoring non-decision Checkr event");
        return res.status(200).json({ received: true });
      } catch (err: any) {
        logger.error({ err, eventType: event.type }, "Failed to process Checkr webhook");
        return res.status(500).json({ message: "Internal error processing webhook" });
      }
    },
  );
}
