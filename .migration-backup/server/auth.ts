import type { Express, Request, RequestHandler } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { eq } from "drizzle-orm";
import rateLimit from "express-rate-limit";
import { db } from "./db";
import { users, type PublicUser } from "@shared/schema";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}

const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function requireSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET environment variable is required.");
  }
  return secret;
}

function getSessionMiddleware() {
  const PgStore = connectPg(session);
  const store = new PgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: SESSION_TTL_SECONDS,
    tableName: "sessions",
  });
  return session({
    secret: requireSecret(),
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS * 1000,
    },
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSessionMiddleware());
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  next();
};

export function getUserId(req: Request): string {
  const id = req.session.userId;
  if (!id) throw new Error("getUserId() called without an authenticated session");
  return id;
}

export function toPublicUser(user: typeof users.$inferSelect): PublicUser {
  const { passwordHash: _omit, ...rest } = user;
  return rest;
}

const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email."),
  password: z.string().min(8, "Password must be at least 8 characters."),
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Please enter a valid email."),
  password: z.string().min(1, "Password is required."),
});

function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

function destroySession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.destroy((err) => (err ? reject(err) : resolve()));
  });
}

async function startSession(req: Request, userId: string): Promise<void> {
  await regenerateSession(req);
  req.session.userId = userId;
  await saveSession(req);
}

const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

export function registerAuthRoutes(app: Express): void {
  app.post("/api/register", async (req, res) => {
    try {
      const input = registerSchema.parse(req.body);

      const existing = await db.select().from(users).where(eq(users.email, input.email));
      if (existing.length > 0) {
        return res.status(409).json({
          message: "An account with that email already exists.",
          field: "email",
        });
      }

      const passwordHash = await bcrypt.hash(input.password, 12);
      const [created] = await db
        .insert(users)
        .values({
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        })
        .returning();

      await startSession(req, created.id);
      res.status(201).json(toPublicUser(created));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      }
      throw err;
    }
  });

  app.post("/api/login", loginRateLimiter, async (req, res) => {
    try {
      const input = loginSchema.parse(req.body);
      const [user] = await db.select().from(users).where(eq(users.email, input.email));

      if (!user || !user.passwordHash) {
        return res.status(401).json({ message: "Invalid email or password." });
      }
      const ok = await bcrypt.compare(input.password, user.passwordHash);
      if (!ok) {
        return res.status(401).json({ message: "Invalid email or password." });
      }

      await startSession(req, user.id);
      res.status(200).json(toPublicUser(user));
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res
          .status(400)
          .json({ message: err.errors[0].message, field: err.errors[0].path.join(".") });
      }
      throw err;
    }
  });

  app.post("/api/logout", async (req, res) => {
    try {
      if (req.session.userId) {
        await destroySession(req);
      }
      res.clearCookie("connect.sid");
      res.status(200).json({ ok: true });
    } catch {
      res.status(500).json({ message: "Failed to log out" });
    }
  });

  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    const [user] = await db.select().from(users).where(eq(users.id, req.session.userId!));
    if (!user) {
      await destroySession(req).catch(() => {});
      return res.status(401).json({ message: "Unauthorized" });
    }
    res.status(200).json(toPublicUser(user));
  });
}
