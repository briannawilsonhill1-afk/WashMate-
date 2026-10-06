/**
 * Clerk Frontend API Proxy Middleware
 *
 * Proxies Clerk Frontend API requests through your domain, enabling Clerk
 * authentication on custom domains and .replit.app deployments without
 * requiring CNAME DNS configuration.
 *
 * AUTH CONFIGURATION: To manage users, enable/disable login providers
 * (Google, GitHub, etc.), change app branding, or configure OAuth credentials,
 * use the Auth pane in the workspace toolbar. There is no external Clerk
 * dashboard — all auth configuration is done through the Auth pane.
 *
 * IMPORTANT:
 * - Only active in production (Clerk proxying doesn't work for dev instances)
 * - Must be mounted BEFORE express.json() middleware
 *
 * Usage in app.ts:
 *   import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware";
 *   app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
 */

import { createProxyMiddleware } from "http-proxy-middleware";
import type { RequestHandler } from "express";
import type { IncomingHttpHeaders } from "http";
import { logger } from "../lib/logger";
import { deploymentDomains } from "../lib/domains";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

/**
 * Builds the set of approved public hostnames for this deployment from the
 * REPLIT_DOMAINS environment variable (comma-separated list of production
 * hostnames provided by the Replit platform).
 *
 * This set is the source of truth for which hosts are allowed to be used as
 * the Clerk proxy URL. It is computed once at module load so it cannot be
 * influenced by request-time input.
 *
 * Emits a warning in production when the set is empty, because that means no
 * host can be resolved and all proxy requests will be rejected with 503.
 */
/**
 * Normalizes a host string for allowlist comparison: lowercases and strips
 * the default https port (:443). This avoids false rejections when ingress
 * forwards `Example.com:443` while the allowlist holds `example.com`.
 *
 * Returns undefined for falsy/empty inputs.
 */
export function normalizeHost(host: string | undefined): string | undefined {
  if (!host) return undefined;
  const lowered = host.trim().toLowerCase();
  if (!lowered) return undefined;
  return lowered.endsWith(":443") ? lowered.slice(0, -4) : lowered;
}

export function buildAllowedHosts(
  replitDomains = deploymentDomains().join(","),
): Set<string> {
  const allowed = new Set<string>();
  for (const domain of replitDomains.split(",")) {
    const normalized = normalizeHost(domain);
    if (normalized) allowed.add(normalized);
  }
  return allowed;
}

const allowedHosts = buildAllowedHosts();

if (process.env.NODE_ENV === "production" && allowedHosts.size === 0) {
  logger.warn(
    "REPLIT_DOMAINS is not set in production — the Clerk auth proxy cannot " +
      "resolve a valid host. All requests to the Clerk proxy path will be " +
      "rejected with 503. Set REPLIT_DOMAINS to the comma-separated list of " +
      "production hostnames.",
  );
}

/**
 * Returns the canonical public hostname for the given request, validated
 * against the deployment's approved domain list.
 *
 * We read x-forwarded-host as a hint for multi-domain support, but we ONLY
 * accept the value if it appears in the REPLIT_DOMAINS allowlist. This
 * prevents attackers from supplying an arbitrary x-forwarded-host to make the
 * server act as a Clerk proxy for an unrelated domain.
 *
 * Resolution rules (fail-closed):
 *   1. If x-forwarded-host or Host header is present and matches an
 *      allowlisted domain, return it.
 *   2. If either header is present but neither matches the allowlist, return
 *      undefined. The caller must reject the request — silently proxying
 *      under a different approved domain would mask routing misconfiguration
 *      and could let a forged header trigger a domain swap.
 *   3. If no relevant headers are present (e.g. internal health checks), fall
 *      back to the first allowlist entry as a server-side constant.
 *   4. If the allowlist itself is empty, return undefined.
 *
 * Exported so that tests and callers can reuse the same host resolution logic.
 */
export function getClerkProxyHost(
  req: { headers: IncomingHttpHeaders },
  hosts: Set<string> = allowedHosts,
): string | undefined {
  // In non-production there is no proxy — callers should not use the result
  // for Clerk-Proxy-Url construction, but we still return the Host header so
  // clerkMiddleware can fall back to the env-var publishable key.
  if (process.env.NODE_ENV !== "production") {
    return req.headers.host?.trim() || undefined;
  }

  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = normalizeHost(raw?.split(",")[0]);
  const hostHeader = normalizeHost(req.headers.host);

  if (firstHop && hosts.has(firstHop)) {
    return firstHop;
  }

  if (hostHeader && hosts.has(hostHeader)) {
    return hostHeader;
  }

  // Fail closed: if the client supplied any host-identifying header and none
  // of the values are allowlisted, do NOT fall back to another approved
  // domain. That would let a forged x-forwarded-host trigger a silent domain
  // swap and would hide real routing misconfiguration.
  if (firstHop || hostHeader) {
    return undefined;
  }

  // No host headers at all (e.g. internal health probe). Fall back to the
  // first configured production domain — a server-side constant.
  const [first] = hosts;
  return first ?? undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  // Only run proxy in production — Clerk proxying doesn't work for dev instances
  if (process.env.NODE_ENV !== "production") {
    return (_req, _res, next) => next();
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return (_req, _res, next) => next();
  }

  const proxy = createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    pathRewrite: (path: string) =>
      path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        // Always use https in production — never trust client-supplied
        // x-forwarded-proto, which an attacker could set to any value.
        const protocol = "https";
        const host = getClerkProxyHost(req) ?? "";
        const proxyUrl = `${protocol}://${host}${CLERK_PROXY_PATH}`;

        proxyReq.setHeader("Clerk-Proxy-Url", proxyUrl);
        proxyReq.setHeader("Clerk-Secret-Key", secretKey);

        // Use Express's trusted req.ip rather than re-parsing the raw
        // X-Forwarded-For header. The app sets `trust proxy: 1` in auth.ts,
        // so req.ip is already resolved against the trusted proxy chain and
        // cannot be spoofed by a client-supplied XFF value.
        const clientIp = (req as import("express").Request).ip;
        if (clientIp) {
          proxyReq.setHeader("X-Forwarded-For", clientIp);
        }
      },
    },
  }) as RequestHandler;

  // Guard: reject requests when no approved host can be resolved.
  // This prevents constructing a malformed Clerk-Proxy-Url with an empty host,
  // and gives operators a clear signal that REPLIT_DOMAINS is misconfigured.
  return (req, res, next) => {
    const resolvedHost = getClerkProxyHost(req);
    if (!resolvedHost) {
      logger.error(
        { url: req.url },
        "Clerk proxy request rejected: no approved host resolved. " +
          "Ensure REPLIT_DOMAINS is configured correctly.",
      );
      res
        .status(503)
        .json({ message: "Auth proxy unavailable: host configuration missing" });
      return;
    }
    proxy(req, res, next);
  };
}
