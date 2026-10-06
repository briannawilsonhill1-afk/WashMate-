import { randomUUID } from "node:crypto";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import { pushReceiptQueue } from "@workspace/db";
import { db } from "./db";
import { logger } from "./lib/logger";

const RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const INITIAL_DELAY_MS = 15 * 60_000;
const RETRY_DELAY_MS = 5 * 60_000;
const WORKER_INTERVAL_MS = 60_000;
const CLAIM_LEASE_MS = 2 * 60_000;
const MAX_ATTEMPTS = 3;
const MAX_PENDING = 10_000;
const BATCH_SIZE = 1_000;

interface PendingReceipt {
  ticketId: string;
  token: string;
  attempts: number;
}


interface Receipt {
  status?: string;
  details?: { error?: string };
}

type ReceiptFailureCategory = "provider" | "database" | "malformed_response";

export interface ReceiptStore {
  enqueue(entry: { ticketId: string; token: string; dueAt: Date }): Promise<boolean>;
  claimDue(
    now: Date,
    limit: number,
    claimId: string,
    claimUntil: Date,
  ): Promise<PendingReceipt[]>;
  complete(ticketId: string, claimId: string): Promise<void>;
  retry(ticketId: string, claimId: string, dueAt: Date): Promise<void>;
  expire(ticketId: string, claimId: string): Promise<void>;
  hasPending(): Promise<boolean>;
}

/**
 * Receipt tickets are inserted concurrently by notification sends. The
 * transaction advisory lock makes the capacity check a real bound across
 * multiple API instances; the ticket primary key makes retries idempotent.
 */
export class DatabaseReceiptStore implements ReceiptStore {
  async enqueue(entry: {
    ticketId: string;
    token: string;
    dueAt: Date;
  }): Promise<boolean> {
    return db.transaction(async (transaction) => {
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext('washmate:push-receipt-queue'))`,
      );

      const existing = await transaction
        .select({ ticketId: pushReceiptQueue.ticketId })
        .from(pushReceiptQueue)
        .where(eq(pushReceiptQueue.ticketId, entry.ticketId))
        .limit(1);
      if (existing.length > 0) return true;

      const countResult = await transaction
        .select({ count: sql<number>`count(*)::int` })
        .from(pushReceiptQueue);
      if (Number(countResult[0]?.count ?? 0) >= MAX_PENDING) return false;

      await transaction
        .insert(pushReceiptQueue)
        .values({
          ticketId: entry.ticketId,
          token: entry.token,
          dueAt: entry.dueAt,
        })
        .onConflictDoNothing({ target: pushReceiptQueue.ticketId });
      return true;
    });
  }

  async claimDue(
    now: Date,
    limit: number,
    claimId: string,
    claimUntil: Date,
  ): Promise<PendingReceipt[]> {
    return db.transaction(async (transaction) => {
      const due = await transaction
        .select({
          ticketId: pushReceiptQueue.ticketId,
          token: pushReceiptQueue.token,
        })
        .from(pushReceiptQueue)
        .where(and(
          lte(pushReceiptQueue.dueAt, now),
          or(
            isNull(pushReceiptQueue.claimUntil),
            lte(pushReceiptQueue.claimUntil, now),
          ),
        ))
        .orderBy(asc(pushReceiptQueue.dueAt))
        .limit(limit)
        .for("update", { skipLocked: true });

      if (due.length === 0) return [];

      const claimed = await transaction
        .update(pushReceiptQueue)
        .set({
          attempts: sql`${pushReceiptQueue.attempts} + 1`,
          claimId,
          claimUntil,
        })
        .where(inArray(
          pushReceiptQueue.ticketId,
          due.map((entry) => entry.ticketId),
        ))
        .returning({
          ticketId: pushReceiptQueue.ticketId,
          token: pushReceiptQueue.token,
          attempts: pushReceiptQueue.attempts,
        });
      return claimed;
    });
  }

  async complete(ticketId: string, claimId: string): Promise<void> {
    await db
      .delete(pushReceiptQueue)
      .where(and(
        eq(pushReceiptQueue.ticketId, ticketId),
        eq(pushReceiptQueue.claimId, claimId),
      ));
  }

  async retry(ticketId: string, claimId: string, dueAt: Date): Promise<void> {
    await db
      .update(pushReceiptQueue)
      .set({ dueAt, claimId: null, claimUntil: null })
      .where(and(
        eq(pushReceiptQueue.ticketId, ticketId),
        eq(pushReceiptQueue.claimId, claimId),
      ));
  }

  async expire(ticketId: string, claimId: string): Promise<void> {
    await db
      .delete(pushReceiptQueue)
      .where(and(
        eq(pushReceiptQueue.ticketId, ticketId),
        eq(pushReceiptQueue.claimId, claimId),
      ));
  }

  async hasPending(): Promise<boolean> {
    const rows = await db
      .select({ ticketId: pushReceiptQueue.ticketId })
      .from(pushReceiptQueue)
      .limit(1);
    return rows.length > 0;
  }
}

export class PushReceiptQueue {
  private scheduled = false;
  private readonly store: ReceiptStore;

  constructor(
    private removeTokens: (tokens: string[]) => Promise<void>,
    store: ReceiptStore = new DatabaseReceiptStore(),
  ) {
    this.store = store;
    // The first tick is also the restart recovery pass. It discovers rows
    // from the database rather than relying on process-local state.
    this.schedule();
  }

  enqueue(id: string, token: string): void {
    void this.store
      .enqueue({
        ticketId: id,
        token,
        dueAt: new Date(Date.now() + INITIAL_DELAY_MS),
      })
      .then((accepted) => {
        if (!accepted) {
          logger.warn("Expo receipt queue full; receipt skipped");
        }
      })
      .catch(() => {
        // The next worker tick can still recover any rows that were already
        // committed. Do not include the token in persistence error logs.
        logger.warn("Expo receipt enqueue failed");
      });
    this.schedule();
  }

  private schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setTimeout(() => {
      void this.checkDue()
        .catch(() => logger.warn("Expo receipt worker failed"))
        .finally(() => {
          this.scheduled = false;
          void this.store
            .hasPending()
            .then((hasPending) => {
              if (hasPending) this.schedule();
            })
            .catch(() => {
              logger.warn("Expo receipt worker could not inspect pending work");
              this.schedule();
            });
        });
    }, WORKER_INTERVAL_MS).unref();
  }

  private async checkDue(): Promise<void> {
    while (true) {
      const claimId = randomUUID();
      const now = new Date();
      const batch = await this.store.claimDue(
        now,
        BATCH_SIZE,
        claimId,
        new Date(now.getTime() + CLAIM_LEASE_MS),
      );
      if (batch.length === 0) return;

      const completed = new Set<string>();
      let failureCategory: ReceiptFailureCategory | undefined;
      try {
        const response = await fetch(RECEIPTS_URL, {
          method: "POST",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({ ids: batch.map((entry) => entry.ticketId) }),
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) throw new Error("Receipt request failed");
        failureCategory = "malformed_response";
        const json = await response.json() as { data?: Record<string, Receipt> };
        if (!json.data || typeof json.data !== "object" || Array.isArray(json.data)) {
          throw new Error("Invalid receipt response");
        }

        const stale: string[] = [];
        const completedEntries: PendingReceipt[] = [];
        let malformed = 0;
        for (const entry of batch) {
          const receipt = json.data[entry.ticketId];
          if (receipt?.status !== "ok" && receipt?.status !== "error") {
            malformed++;
            continue;
          }
          if (receipt.status === "error") {
            if (receipt.details?.error === "DeviceNotRegistered") {
              stale.push(entry.token);
            } else {
              // Provider details and device tokens must never enter logs.
              logger.warn({ code: receipt.details?.error }, "Expo push receipt error");
            }
          }
          completedEntries.push(entry);
        }

        failureCategory = "database";
        if (stale.length) await this.removeTokens([...new Set(stale)]);
        for (const entry of completedEntries) {
          await this.store.complete(entry.ticketId, claimId);
          completed.add(entry.ticketId);
        }
        failureCategory = malformed > 0 ? "malformed_response" : undefined;
        logger.info({
          checked: batch.length,
          completed: completed.size,
          pruned: stale.length,
          malformed,
        }, "Expo push receipts checked");
      } catch {
        logger.warn({
          count: batch.length,
          failureCategory: failureCategory ?? "provider",
          event: "push_receipt_check_failed",
        }, "Expo receipt check failed; retry budget applies");
      }

      let expired = 0;
      for (const entry of batch) {
        if (completed.has(entry.ticketId)) continue;
        try {
          if (entry.attempts >= MAX_ATTEMPTS) {
            await this.store.expire(entry.ticketId, claimId);
            expired++;
          } else {
            await this.store.retry(
              entry.ticketId,
              claimId,
              new Date(Date.now() + RETRY_DELAY_MS),
            );
          }
        } catch {
          logger.warn({
            count: 1,
            event: "push_receipt_persistence_failed",
            failureCategory: "database",
            operation: entry.attempts >= MAX_ATTEMPTS ? "expire" : "retry",
          }, "Expo receipt persistence failed");
          throw new Error("Expo receipt persistence failed");
        }
      }
      if (expired) {
        logger.warn({
          count: expired,
          event: "push_receipt_retries_exhausted",
          failureCategory: failureCategory ?? "provider",
        }, "Expo receipt checks exhausted");
      }
    }
  }
}