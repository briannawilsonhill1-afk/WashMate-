import { getUncachableStripeClient } from "./stripeClient";
import { storage } from "./storage";
import { clerkClient } from "@clerk/express";
import { logger } from "./lib/logger";
import { pool } from "./db";
import { retryWindowOpen } from "./incidentPolicy";

export class PayoutError extends Error {
  constructor(message: string, public code: string) {
    super(message);
  }
}

export const WASHER_PAYOUT_FAILURE_REASON =
  "Payout could not be sent to your bank. Please try again.";

// Lazily create a Stripe Connect Custom account for the washer and attach
// their FC-verified bank as the Connect account's external_account so that
// payouts route to it. Custom accounts with the `recipient` service agreement
// can receive transfers without a full Express onboarding round-trip — that
// is what we need to actually move money to the washer.
//
// Returns the Connect account id, creating it on first call.
export async function ensureConnectAccount(userId: string): Promise<string> {
  const lock = await pool.connect();
  try {
    // Account creation includes remote calls, so use a session advisory lock
    // rather than a row lock held inside a long-running transaction.
    await lock.query("SELECT pg_advisory_lock(72942, hashtext($1))", [userId]);

    const profile = await storage.getWasherProfile(userId);
    if (!profile) throw new PayoutError("Washer profile not found", "NO_PROFILE");
    if (!profile.stripeBankAccountId) throw new PayoutError("No verified bank on file", "NO_VERIFIED_BANK");
    const stripe = await getUncachableStripeClient();
    if (profile.stripeConnectAccountId) {
      // Accounts created before manual scheduling was enforced must also be
      // corrected before another transfer is sent.
      await stripe.accounts.update(profile.stripeConnectAccountId, {
        settings: { payouts: { schedule: { interval: "manual" } } },
      });
      if (profile.stripeConnectBankAccountId !== profile.stripeBankAccountId) {
        await stripe.accounts.createExternalAccount(profile.stripeConnectAccountId, {
          external_account: profile.stripeBankAccountId,
          default_for_currency: true,
        }, { idempotencyKey: `washmate_connect_bank_${userId}_${profile.stripeBankAccountId}` });
        await storage.setStripeConnectAccountId(
          userId,
          profile.stripeConnectAccountId,
          profile.stripeBankAccountId,
        );
      }
      return profile.stripeConnectAccountId;
    }

    const clerkUser = await clerkClient.users.getUser(userId).catch(() => null);
    const email = clerkUser?.emailAddresses?.[0]?.emailAddress ?? undefined;
    const nameParts = (profile.legalName ?? "").trim().split(/\s+/);
    const firstName = nameParts[0] || undefined;
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : undefined;

    let dob: { day: number; month: number; year: number } | undefined;
    if (profile.dateOfBirth) {
      const m = profile.dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? profile.dateOfBirth.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) {
        const [, a, b, c] = m;
        const isISO = a.length === 4;
        dob = isISO
          ? { year: Number(a), month: Number(b), day: Number(c) }
          : { month: Number(a), day: Number(b), year: Number(c) };
      }
    }

    // Stable idempotency keys recover the same Stripe objects if Stripe
    // succeeds but the process exits before the local account id is persisted.
    const account = await stripe.accounts.create({
      type: "custom",
      country: "US",
      email,
      capabilities: { transfers: { requested: true } },
      settings: { payouts: { schedule: { interval: "manual" } } },
      business_type: "individual",
      individual: {
        first_name: firstName,
        last_name: lastName,
        email,
        phone: profile.phone || undefined,
        dob,
        ssn_last_4: profile.taxId ? profile.taxId.replace(/\D/g, "").slice(-4) || undefined : undefined,
        address: profile.state ? { country: "US", state: profile.state, city: profile.county || undefined } : undefined,
      },
      tos_acceptance: {
        // Keep every create parameter stable across retries of the same
        // idempotency key. Bank verification time is persisted before this.
        date: Math.floor((profile.stripeVerifiedAt ?? profile.updatedAt ?? new Date(0)).getTime() / 1000),
        ip: "127.0.0.1",
        service_agreement: "recipient",
      },
      metadata: { washmateUserId: userId },
    }, { idempotencyKey: `washmate_connect_account_${userId}` });

    try {
      await stripe.accounts.createExternalAccount(account.id, {
        external_account: profile.stripeBankAccountId,
        default_for_currency: true,
      }, { idempotencyKey: `washmate_connect_bank_${userId}_${profile.stripeBankAccountId}` });
    } catch (err: any) {
      logger.error({ err, userId, connectAccountId: account.id }, "Failed to attach FC bank to Connect account");
      throw new PayoutError(`Could not attach verified bank to payout account: ${err?.message ?? "unknown"}`, "ATTACH_BANK_FAILED");
    }

    await storage.setStripeConnectAccountId(userId, account.id, profile.stripeBankAccountId);
    return account.id;
  } finally {
    await lock.query("SELECT pg_advisory_unlock(72942, hashtext($1))", [userId]).catch((err) => {
      logger.error({ err, userId }, "Failed to release Connect account creation lock");
    });
    lock.release();
  }
}

// Execute a previously-recorded `pending` payout against Stripe. We:
//   1. Ensure the washer has a Connect account with their bank attached.
//   2. Create a Transfer (platform balance -> Connect account balance) using
//      a deterministic idempotency key so retries can never double-pay.
//   3. Create a Payout on the Connect account (Connect balance -> bank), again
//      idempotent. The Payout.status starts `pending` until Stripe settles it
//      via ACH; the `payout.paid` / `payout.failed` webhook flips our row.
// Any Stripe failure marks the local payout `failed` and releases its orders
// so the washer can retry once the underlying issue is fixed.
export async function executePayout(payoutId: number): Promise<void> {
  const lock = await pool.connect();
  try {
    await lock.query("SELECT pg_advisory_lock(72941, $1)", [payoutId]);
    await executeLockedPayout(payoutId);
  } finally {
    await lock.query("SELECT pg_advisory_unlock(72941, $1)", [payoutId]);
    lock.release();
  }
}

async function executeLockedPayout(payoutId: number): Promise<void> {
  const payout = await storage.getPayout(payoutId);
  if (!payout) throw new PayoutError("Payout not found", "NOT_FOUND");
  if (payout.status !== "pending") return; // already settled — no-op
  if (payout.stripeTransferId) return; // Stripe call already succeeded earlier; webhook will close it out
  if (payout.amountCents === 0) {
    // The full washer share paid down incident debt. There is no bank transfer.
    await storage.markPayoutPaid(payoutId, null);
    return;
  }
  if (payout.amountCents < 0) throw new PayoutError("Invalid payout amount", "INVALID_AMOUNT");
  if (!retryWindowOpen(payout.transferAttemptAt)) throw new PayoutError("Transfer requires reconciliation before retry", "RECONCILIATION_REQUIRED");

  const stripe = await getUncachableStripeClient();
  let connectAccountId: string;
  try {
    connectAccountId = await ensureConnectAccount(payout.washerId);
  } catch (err: any) {
    logger.error({ err, payoutId }, "Failed to prepare payout");
    await storage.markPayoutFailed(payoutId, WASHER_PAYOUT_FAILURE_REASON);
    throw err;
  }

  let transferId: string;
  // Durable attempt prevents an ambiguous network failure from releasing orders
  // and fee reservations into a second transfer with a new idempotency key.
  const attempt = await pool.query(`UPDATE payouts SET transfer_attempt_at=COALESCE(transfer_attempt_at,NOW()),
    stripe_connect_account_id=$2 WHERE id=$1 AND status='pending' RETURNING id`, [payoutId,connectAccountId]);
  if (!attempt.rowCount) return;
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: payout.amountCents,
        currency: "usd",
        destination: connectAccountId,
        metadata: { washmatePayoutId: String(payoutId), washmateWasherId: payout.washerId },
      },
      { idempotencyKey: `washmate_transfer_${payoutId}` },
    );
    transferId = transfer.id;
  } catch (err: any) {
    logger.error({ err, payoutId, connectAccountId }, "Stripe transfer failed");
    if (err?.type === "StripeInvalidRequestError" && err?.statusCode === 400) {
      await pool.query("UPDATE payouts SET transfer_attempt_at=NULL WHERE id=$1 AND stripe_transfer_id IS NULL", [payoutId]);
    }
    await storage.markPayoutFailed(payoutId, WASHER_PAYOUT_FAILURE_REASON);
    throw new PayoutError(err?.message ?? "Transfer failed", "TRANSFER_FAILED");
  }

  await storage.setPayoutStripeIds(payoutId, {
    stripeConnectAccountId: connectAccountId, stripeTransferId: transferId, stripePayoutId: null,
  });
  let stripePayoutId: string | null = null;
  try {
    const stripePayout = await stripe.payouts.create(
      {
        amount: payout.amountCents,
        currency: "usd",
        metadata: { washmatePayoutId: String(payoutId) },
      },
      {
        stripeAccount: connectAccountId,
        idempotencyKey: `washmate_payout_${payoutId}`,
      },
    );
    stripePayoutId = stripePayout.id;
  } catch (err: any) {
    // Automatic payouts are disabled. The transferred balance stays in the
    // Connect account until this idempotent manual payout can be retried or
    // an operator reconciles it.
    logger.warn({ err, payoutId, connectAccountId }, "Manual payouts.create failed; Connect balance requires reconciliation");
  }

  await storage.setPayoutStripeIds(payoutId, {
    stripeConnectAccountId: connectAccountId,
    stripeTransferId: transferId,
    stripePayoutId,
  });
}
