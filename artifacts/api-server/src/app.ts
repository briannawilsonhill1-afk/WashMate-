import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import { deploymentDomains } from "./lib/domains";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  clerkAuthMiddleware,
} from "./auth";
import { mountStripeWebhook } from "./routes/stripeWebhook";

/**
 * Build the set of origins that are allowed to make credentialed cross-origin
 * requests to the API.
 *
 * Allowed origins:
 *   - Any hostname listed in REPLIT_DOMAINS (production domains, comma-separated)
 *   - localhost (any port) — development only
 *
 * Rejecting all other origins prevents login-CSRF / account-forcing attacks
 * where a malicious site could silently establish an authenticated WashMate
 * session in a visitor's browser via a cross-origin credentialed fetch.
 */
function buildAllowedOrigins(): Set<string> {
  const domains = deploymentDomains();

  if (domains.length === 0 && process.env["NODE_ENV"] === "production") {
    logger.warn(
      "No deployment domains are configured in production — no origins " +
        "will be allowed for credentialed CORS. Set ALLOWED_DOMAINS (or " +
        "REPLIT_DOMAINS) to the comma-separated list of production hostnames.",
    );
  }

  return new Set(domains.map((domain) => `https://${domain}`));
}

const allowedOrigins = buildAllowedOrigins();

function isAllowedOrigin(origin: string): boolean {
  if (allowedOrigins.has(origin)) return true;
  // Allow localhost (any port) for local development.
  try {
    const url = new URL(origin);
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
      return true;
    }
  } catch {
    // Not a valid URL — deny.
  }
  return false;
}

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk Frontend API proxy must be mounted before body parsers (it streams
// raw bytes through to Clerk's API).
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

// Stripe webhook needs the raw request body for HMAC signature verification,
// so it MUST be registered synchronously before express.json() below — a
// dynamic import would resolve after the JSON parser is mounted, which would
// silently corrupt signature verification (constructEvent on a parsed body
// always fails) and effectively disable the webhook.
mountStripeWebhook(app);

app.use(
  cors({
    origin(origin, callback) {
      // Same-origin and server-to-server requests have no Origin header.
      if (!origin) return callback(null, true);
      if (isAllowedOrigin(origin)) return callback(null, true);
      // Return false (not an Error) so the cors middleware sends a proper
      // CORS-blocked response (no Access-Control-Allow-Origin header) rather
      // than propagating a 500-style error.
      callback(null, false);
    },
    credentials: true,
  }),
);

// Return 403 for requests that were blocked by the CORS origin check above.
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers["origin"];
  if (origin && !isAllowedOrigin(origin)) {
    return res.status(403).json({ message: "Forbidden: cross-origin request from disallowed origin" });
  }
  return next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initializes Clerk auth using CLERK_PUBLISHABLE_KEY from the environment.
// The publishable key is intentionally NOT derived from request headers —
// see auth.ts and middlewares/clerkProxyMiddleware.ts for the boundary
// rationale. Populates req.auth used by getAuth().
app.use(clerkAuthMiddleware());

export default app;
