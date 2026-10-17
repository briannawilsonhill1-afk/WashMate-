import { logger } from "./logger";

/**
 * Version of the WashMate washer terms that the Connect ToS acceptance
 * evidence refers to. Bump this whenever the washer terms change; washers
 * whose recorded evidence references an older version must re-accept before
 * a new Connect account is provisioned.
 */
export const WASHER_TOS_VERSION = "1.0";

export type ConnectAccountType = "custom" | "express";

/**
 * Which Stripe Connect account model to provision for washers.
 *
 * - "custom" (default): WashMate creates Custom accounts via the API and
 *   records the washer's ToS acceptance itself (date + real client IP +
 *   version persisted on the washer profile). This matches the current
 *   Financial Connections bank-verification flow.
 * - "express": Stripe-hosted onboarding. Not yet implemented — selecting it
 *   fails fast instead of silently provisioning the wrong account type.
 *
 * Which model is approved for this business is a product/compliance decision
 * to confirm against Stripe's current Connect requirements.
 */
export function getConnectAccountType(env: NodeJS.ProcessEnv = process.env): ConnectAccountType {
  const raw = (env["STRIPE_CONNECT_ACCOUNT_TYPE"] ?? "custom").trim().toLowerCase();
  if (raw === "custom" || raw === "express") return raw;
  throw new Error(
    `Invalid STRIPE_CONNECT_ACCOUNT_TYPE: "${env["STRIPE_CONNECT_ACCOUNT_TYPE"]}". ` +
      `Expected "custom" or "express".`,
  );
}

/**
 * Resolve the client IP for ToS-acceptance evidence.
 *
 * The app sets `trust proxy: 1` (see auth.ts), so Express's `req.ip` is
 * already resolved against the trusted proxy chain (Vercel/Replit edge) and
 * cannot be spoofed by a client-supplied X-Forwarded-For value. Never parse
 * X-Forwarded-For directly here.
 */
export function resolveClientIp(req: { ip?: string }): string | undefined {
  const ip = req.ip?.trim();
  if (!ip) {
    logger.warn("Could not resolve client IP for ToS acceptance evidence");
    return undefined;
  }
  return ip;
}
