import { getAuth } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import { createHash } from "node:crypto";
import { activeUsers, db } from "@workspace/db";
import { count, gte, lt, sql } from "drizzle-orm";
import { logger } from "./lib/logger";

const DEFAULT_WINDOW_MINUTES = 15;

export interface ActiveUserStore {
  record(identifierHash: string, seenAt: Date): Promise<void>;
  deleteBefore(cutoff: Date): Promise<void>;
  countSince(cutoff: Date): Promise<number>;
}

export class DatabaseActiveUserStore implements ActiveUserStore {
  async record(identifierHash: string, seenAt: Date): Promise<void> {
    await db
      .insert(activeUsers)
      .values({ identifierHash, lastSeenAt: seenAt })
      .onConflictDoUpdate({
        target: activeUsers.identifierHash,
        set: {
          lastSeenAt: sql`GREATEST(${activeUsers.lastSeenAt}, excluded.last_seen_at)`,
        },
      });
  }

  async deleteBefore(cutoff: Date): Promise<void> {
    await db.delete(activeUsers).where(lt(activeUsers.lastSeenAt, cutoff));
  }

  async countSince(cutoff: Date): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(activeUsers)
      .where(gte(activeUsers.lastSeenAt, cutoff));
    return result?.value ?? 0;
  }
}

function hashIdentifier(identifier: string): string {
  return createHash("sha256").update(identifier).digest("hex");
}

export class ActiveUserTracker {
  constructor(
    private readonly store: ActiveUserStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async record(identifier: string): Promise<void> {
    await this.store.record(hashIdentifier(identifier), this.now());
  }

  async count(windowInMinutes = DEFAULT_WINDOW_MINUTES): Promise<number> {
    const cutoff = new Date(
      this.now().getTime() - windowInMinutes * 60 * 1000,
    );
    await this.store.deleteBefore(cutoff);
    return this.store.countSince(cutoff);
  }
}

const tracker = new ActiveUserTracker(new DatabaseActiveUserStore());

export const trackActiveUser: RequestHandler = async (req, _res, next) => {
  try {
    const userId = getAuth(req)?.userId;
    const identifier = userId ? `user:${userId}` : `ip:${req.ip ?? "unknown"}`;
    await tracker.record(identifier);
    next();
  } catch (error) {
    logger.warn({ error }, "Unable to record active user");
    next();
  }
};

export function registerActiveUserRoutes(app: Express): void {
  app.get("/api/active-users", async (_req, res, next) => {
    try {
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({
        activeUsersCount: await tracker.count(DEFAULT_WINDOW_MINUTES),
        windowInMinutes: DEFAULT_WINDOW_MINUTES,
      });
    } catch (error) {
      return next(error);
    }
  });
}