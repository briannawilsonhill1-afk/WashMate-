import { deploymentDomains } from "./domains";
import { getConnectAccountType } from "./tos";
import { getAdverseActionWaitDays, getFcraBusinessDetails } from "./fcra";
import { logger } from "./logger";

/**
 * Fail-fast validation of launch-critical configuration, run before the app
 * accepts traffic. Only variable *names* are ever logged — never values.
 */
export function assertRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing: string[] = [];
  if (!env["DATABASE_URL"]) missing.push("DATABASE_URL");
  if (!env["FIELD_ENCRYPTION_KEY"]) missing.push("FIELD_ENCRYPTION_KEY");

  // Stripe credentials come either from explicit env keys (Vercel) or from
  // the Replit connector proxy — one of the two must be configured.
  const hasStripeKeys = Boolean(env["STRIPE_SECRET_KEY"] && env["STRIPE_PUBLISHABLE_KEY"]);
  const hasReplitConnector = Boolean(
    env["REPLIT_CONNECTORS_HOSTNAME"] && (env["REPL_IDENTITY"] || env["WEB_REPL_RENEWAL"]),
  );
  if (!hasStripeKeys && !hasReplitConnector) {
    missing.push("STRIPE_SECRET_KEY/STRIPE_PUBLISHABLE_KEY (or Replit Stripe connector)");
  }
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        `Payments and data protection will not function without these.`,
    );
  }

  // Without the webhook secret the Stripe webhook endpoint rejects every
  // event, so payouts could never settle. Hard-require it in production;
  // warn in other environments where webhooks may be untestable.
  if (!env["STRIPE_WEBHOOK_SECRET"]) {
    if (env["NODE_ENV"] === "production") {
      throw new Error(
        "STRIPE_WEBHOOK_SECRET is required in production — without it Stripe " +
          "payout webhooks are rejected and payouts can never settle.",
      );
    }
    logger.warn("STRIPE_WEBHOOK_SECRET is not set; the Stripe webhook endpoint will reject all events");
  }

  // Credentialed CORS and the Clerk proxy allowlist are derived from the
  // deployment domains; with none configured in production the API is
  // unreachable from the web app.
  if (env["NODE_ENV"] === "production" && deploymentDomains(env).length === 0) {
    throw new Error(
      "No production deployment domains configured — set ALLOWED_DOMAINS (or " +
        "REPLIT_DOMAINS) to the comma-separated production hostnames.",
    );
  }

  // Validates STRIPE_CONNECT_ACCOUNT_TYPE ("custom" default / "express");
  // throws on any other value.
  getConnectAccountType(env);

  // Checkr screens every washer before they can claim jobs. Without the API
  // key no invitations can be created; without the webhook secret, report
  // deliveries cannot be verified; without the package slug, invitations
  // cannot be ordered. Hard-require all three in production; warn elsewhere.
  const checkrMissing: string[] = [];
  if (!env["CHECKR_API_KEY"]) checkrMissing.push("CHECKR_API_KEY");
  if (!env["CHECKR_WEBHOOK_SECRET"]) checkrMissing.push("CHECKR_WEBHOOK_SECRET");
  if (!env["CHECKR_PACKAGE"]) checkrMissing.push("CHECKR_PACKAGE");
  if (checkrMissing.length > 0) {
    if (env["NODE_ENV"] === "production") {
      throw new Error(
        `Missing required environment variables: ${checkrMissing.join(", ")}. ` +
          `Washer background screening cannot function without these.`,
      );
    }
    logger.warn(
      `Checkr is not fully configured (${checkrMissing.join(", ")} missing); ` +
        `washer screenings will stay pending for operator decision`,
    );
  }

  // Validate the adverse-action waiting period parses to a positive number of
  // days (falls back to the default otherwise — never crashes startup).
  getAdverseActionWaitDays(env);

  // Adverse-action notices are generated from templates that need real
  // business contact details. Warn (don't fail) when they are still
  // placeholders: the admin endpoints refuse to generate notices until the
  // details are configured, so a deploy is safe but notices are blocked.
  const fcraDetails = getFcraBusinessDetails(env);
  if (!fcraDetails.isConfigured) {
    logger.warn(
      "FCRA business details (FCRA_BUSINESS_NAME/FCRA_BUSINESS_ADDRESS/FCRA_BUSINESS_PHONE) " +
        "are not configured; adverse-action notices cannot be generated until they are set. " +
        "Have employment counsel review the notice templates before configuring.",
    );
  }
}
