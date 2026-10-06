import type { Express, Request, RequestHandler } from "express";
import { clerkMiddleware, getAuth, clerkClient } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users, type PublicUser } from "@workspace/db";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

export { CLERK_PROXY_PATH, clerkProxyMiddleware };

export function clerkAuthMiddleware(): RequestHandler {
  // The publishable key encodes the Clerk Frontend API host. When the frontend
  // talks to Clerk through our /api/__clerk proxy, session JWTs are issued for
  // that proxy host — so the backend must validate against a publishable key
  // whose encoded FAPI host matches the same proxy host. publishableKeyFromHost
  // synthesizes that key from the request's resolved public host.
  //
  // This is safe because getClerkProxyHost() validates the host against the
  // REPLIT_DOMAINS allowlist (built once at module load) and fails closed: a
  // forged x-forwarded-host either resolves to undefined (caller falls back to
  // the env-var publishable key) or to an already-approved domain. There is no
  // path for a client to make us synthesize a key for an arbitrary host.
  const envKey = process.env.CLERK_PUBLISHABLE_KEY;
  return clerkMiddleware((req) => {
    const host = getClerkProxyHost(req);
    // Only synthesize a host-derived key when we have a validated allowlisted
    // host. For internal health probes (Host: localhost) and any other request
    // whose host did not pass the allowlist, fall back to the env key — passing
    // an empty host to publishableKeyFromHost throws "Host must not be empty",
    // which would 500 the healthz endpoint and fail deployment health checks.
    return {
      publishableKey: host ? publishableKeyFromHost(host, envKey) : envKey,
    };
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
}

async function ensureUserRecord(
  clerkUserId: string,
): Promise<typeof users.$inferSelect> {
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.id, clerkUserId));
  if (existing[0]) return existing[0];

  const clerkUser = await clerkClient.users.getUser(clerkUserId);
  const email =
    clerkUser.primaryEmailAddress?.emailAddress ??
    clerkUser.emailAddresses[0]?.emailAddress ??
    `${clerkUserId}@noemail.local`;

  await db
    .insert(users)
    .values({
      id: clerkUserId,
      email,
      firstName: clerkUser.firstName ?? null,
      lastName: clerkUser.lastName ?? null,
      profileImageUrl: clerkUser.imageUrl ?? null,
    })
    .onConflictDoNothing({ target: users.id });

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.id, clerkUserId));
  return row;
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const auth = getAuth(req);
  const userId = auth?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    await ensureUserRecord(userId);
    req.userId = userId;
    return next();
  } catch (err) {
    return next(err);
  }
};

export function getUserId(req: Request): string {
  const id = req.userId ?? getAuth(req)?.userId;
  if (!id) {
    throw new Error("getUserId() called without an authenticated request");
  }
  return id;
}

export function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  return user;
}

export function registerAuthRoutes(app: Express): void {
  app.get("/api/auth/user", async (req, res, next) => {
    try {
      const auth = getAuth(req);
      const userId = auth?.userId;
      if (!userId) {
        return res.status(401).json({ message: "Unauthorized" });
      }
      const user = await ensureUserRecord(userId);
      return res.status(200).json(toPublicUser(user));
    } catch (err) {
      return next(err);
    }
  });
}
