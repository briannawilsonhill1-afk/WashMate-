import crypto from "node:crypto";
import { logger } from "./logger";
import { storage } from "../storage";
import { assertFcraAuthorization } from "./fcra";

/**
 * Checkr background-screening integration for washer verification.
 *
 * Flow (Checkr-Hosted Apply Flow — Checkr collects candidate PII itself):
 *   1. Washer completes screening consent in the app (bgCheckStatus → pending).
 *   2. We create a Checkr Candidate with the minimum PII Checkr requires
 *      (email + our user ID as custom_id) and send an Invitation for the
 *      configured package. Checkr emails the washer, who completes their
 *      information and authorization in Checkr's hosted flow.
 *   3. Checkr POSTs `report.completed` to /api/webhooks/checkr when the
 *      report finishes; the verified webhook transitions the washer to
 *      cleared (report clear) or flagged (report consider).
 *
 * Only coarse outcome data is ever persisted (clear/consider/suspended) —
 * never report contents or screening details.
 *
 * Docs: https://docs.checkr.com/ — Candidates, Invitations, Reports,
 * Webhooks. Auth is HTTP Basic with the API key as the username.
 */

export const CHECKR_API_BASE = "https://api.checkr.com/v1";

export interface CheckrConfig {
  apiKey: string;
  /** Package slug from the Checkr dashboard (e.g. the screening package). */
  packageSlug: string;
  /** HMAC secrets to try for webhook verification, in priority order. */
  webhookSecrets: string[];
}

export function getCheckrConfig(env: NodeJS.ProcessEnv = process.env): CheckrConfig | null {
  const apiKey = env["CHECKR_API_KEY"]?.trim();
  if (!apiKey) return null;
  // Prefer a dedicated webhook secret when configured; fall back to the API
  // key, which Checkr also uses to sign webhook deliveries.
  const webhookSecrets = [env["CHECKR_WEBHOOK_SECRET"]?.trim(), apiKey].filter(
    (s): s is string => Boolean(s),
  );
  return {
    apiKey,
    packageSlug: env["CHECKR_PACKAGE"]?.trim() ?? "",
    webhookSecrets,
  };
}

export class CheckrApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(`Checkr API error ${status}: ${message}`);
    this.name = "CheckrApiError";
    this.status = status;
  }
}

type FetchImpl = typeof fetch;

async function checkrRequest(
  config: CheckrConfig,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
  fetchImpl: FetchImpl = fetch,
): Promise<any> {
  const res = await fetchImpl(`${CHECKR_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: "Basic " + Buffer.from(`${config.apiKey}:`).toString("base64"),
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // Non-JSON error body; fall through to the message below.
  }
  if (!res.ok) {
    const message = typeof data?.error === "string" ? data.error : text.slice(0, 200);
    throw new CheckrApiError(res.status, message || "request failed");
  }
  return data;
}

/**
 * Create a Checkr candidate with the minimum PII the API requires. The
 * invitation (hosted apply flow) collects everything else — name, DOB, SSN,
 * address, and the FCRA disclosure/authorization — directly from the washer,
 * so WashMate never handles that sensitive data.
 */
export async function createCheckrCandidate(
  config: CheckrConfig,
  input: { email: string; customId: string },
  fetchImpl: FetchImpl = fetch,
): Promise<{ id: string }> {
  const data = await checkrRequest(
    config,
    "POST",
    "/candidates",
    { email: input.email, custom_id: input.customId },
    fetchImpl,
  );
  if (!data?.id) throw new Error("Checkr candidate creation returned no id");
  return { id: data.id as string };
}

/** Retrieve an invitation to check whether it is still active. */
export async function getCheckrInvitation(
  config: CheckrConfig,
  invitationId: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ id: string; status?: string }> {
  const data = await checkrRequest(config, "GET", `/invitations/${invitationId}`, undefined, fetchImpl);
  if (!data?.id) throw new Error("Checkr invitation lookup returned no id");
  return { id: data.id as string, status: data.status as string | undefined };
}

/**
 * Create a Checkr invitation (hosted apply flow) for the candidate. The
 * package slug comes from CHECKR_PACKAGE; work location (country + state) is
 * required so Checkr can apply the correct state fair-hiring rules.
 */
export async function createCheckrInvitation(
  config: CheckrConfig,
  input: { candidateId: string; state: string },
  fetchImpl: FetchImpl = fetch,
): Promise<{ id: string }> {
  if (!config.packageSlug) {
    throw new Error("CHECKR_NOT_CONFIGURED: set CHECKR_PACKAGE to the Checkr package slug");
  }
  const data = await checkrRequest(
    config,
    "POST",
    "/invitations",
    {
      candidate_id: input.candidateId,
      package: config.packageSlug,
      work_locations: [{ country: "US", state: input.state.toUpperCase() }],
    },
    fetchImpl,
  );
  if (!data?.id) throw new Error("Checkr invitation creation returned no id");
  return { id: data.id as string };
}

/**
 * Verify a Checkr webhook delivery against the raw request body.
 *
 * Checkr signs deliveries with HMAC-SHA256 and sends the hex digest in the
 * `X-Checkr-Signature` header (sent as `sha256=<hex>`; a bare hex digest is
 * also accepted). Every configured secret is tried with a timing-safe
 * comparison so key rotation never drops events.
 */
export function verifyCheckrSignature(
  rawBody: Buffer,
  headerValue: string | undefined,
  secrets: string[],
): boolean {
  if (!headerValue || secrets.length === 0) return false;
  const hex = headerValue.startsWith("sha256=") ? headerValue.slice("sha256=".length) : headerValue;
  let received: Buffer;
  try {
    received = Buffer.from(hex.trim(), "hex");
  } catch {
    return false;
  }
  if (received.length === 0) return false;
  return secrets.some((secret) => {
    const expected = crypto.createHmac("sha256", secret).update(rawBody).digest();
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  });
}

export interface StartScreeningResult {
  candidateId: string;
  invitationId: string;
  /** True when an existing, still-active invitation was reused. */
  invitationReused: boolean;
}

/**
 * Idempotent screening start for a washer whose consent submission set
 * bgCheckStatus to pending.
 *
 * - Reuses the stored Checkr candidate (Checkr recommends one candidate per
 *   person) instead of creating duplicates on re-consent.
 * - Reuses a still-active invitation; orders a fresh one only when there is
 *   none or the previous one expired/vanished.
 * - Persists the Checkr identifiers on the washer profile via
 *   storage.setCheckrScreeningRequest (server-managed columns).
 *
 * Throws CHECKR_NOT_CONFIGURED when no API key is set, so callers can skip
 * gracefully (the screening stays pending for an operator decision).
 */
export async function startWasherScreening(
  input: { userId: string; email: string; state: string },
  opts?: { config?: CheckrConfig | null; fetchImpl?: FetchImpl },
): Promise<StartScreeningResult> {
  const config = opts?.config ?? getCheckrConfig();
  if (!config) throw new Error("CHECKR_NOT_CONFIGURED");
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const state = input.state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(state)) {
    throw new Error(`CHECKR_INVALID_STATE: expected a 2-letter state code, got "${input.state}"`);
  }

  const profile = await storage.getWasherProfile(input.userId);

  // Fail-closed: federal guidance describes written authorization BEFORE a
  // consumer report is procured. Without a valid authorization under the
  // current disclosure version, no candidate or invitation may be created.
  // (Process mechanics only — not a legal conclusion.)
  assertFcraAuthorization(profile);

  let candidateId = profile?.checkrCandidateId ?? null;
  if (!candidateId) {
    const created = await createCheckrCandidate(
      config,
      { email: input.email, customId: input.userId },
      fetchImpl,
    );
    candidateId = created.id;
    logger.info({ userId: input.userId }, "Created Checkr candidate for washer screening");
  }

  let invitationId = profile?.checkrInvitationId ?? null;
  let invitationReused = false;
  if (invitationId) {
    try {
      const existing = await getCheckrInvitation(config, invitationId, fetchImpl);
      if (existing.status === "pending" || existing.status === "completed") {
        invitationReused = true;
      } else {
        // Expired, cancelled, or otherwise inactive — order a fresh one.
        invitationId = null;
      }
    } catch (err) {
      if (err instanceof CheckrApiError && err.status === 404) {
        invitationId = null;
      } else {
        throw err;
      }
    }
  }
  if (!invitationId) {
    const created = await createCheckrInvitation(config, { candidateId, state }, fetchImpl);
    invitationId = created.id;
    logger.info({ userId: input.userId }, "Created Checkr invitation for washer screening");
  }

  await storage.setCheckrScreeningRequest(input.userId, { candidateId, invitationId });
  return { candidateId, invitationId, invitationReused };
}
