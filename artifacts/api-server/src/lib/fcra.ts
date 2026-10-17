/**
 * FCRA background-check workflow mechanics for washer screening.
 *
 * ---------------------------------------------------------------------------
 * IMPORTANT — READ BEFORE TOUCHING THIS FILE
 * ---------------------------------------------------------------------------
 * This module implements *process mechanics*: standalone disclosure
 * presentation, written-authorization capture, adverse-action sequencing with
 * a waiting period, and audit trails. It is NOT legal advice, and using it
 * does NOT make WashMate compliant with the Fair Credit Reporting Act or any
 * state or local law. Employment-screening law is fact-specific and changes;
 * WashMate must have employment counsel review the disclosure text, notice
 * templates, waiting-period length, and the overall workflow before running
 * live screenings. Nothing in this codebase should ever be described to a
 * washer, a regulator, or a court as "FCRA compliant" — describe only what
 * the code does.
 * ---------------------------------------------------------------------------
 *
 * Workflow the code enforces:
 *   1. A washer is shown a STANDALONE disclosure (its own screen, nothing
 *      else on it) naming Checkr as the consumer reporting agency.
 *   2. The washer gives a SEPARATE written (electronic) authorization, which
 *      is recorded server-side with timestamp + IP + disclosure version.
 *   3. Screening cannot start without a valid authorization (fail-closed).
 *   4. If the report comes back "consider", the washer is `flagged`. Before
 *      any final adverse decision, an admin must send a pre-adverse notice
 *      (report copy + Summary of Rights + time to respond), wait the
 *      configured number of business days, then record the final decision.
 *      Every step is audited.
 */

/** Version of the standalone FCRA disclosure text. Bump when counsel approves new text. */
export const FCRA_DISCLOSURE_VERSION = "1.0";

/** Version of the adverse-action notice templates. Bump when counsel approves new text. */
export const FCRA_NOTICE_VERSION = "1.0";

/** Default waiting period between pre-adverse notice and a final adverse decision. */
export const ADVERSE_ACTION_WAIT_DAYS_DEFAULT = 5;

export function getAdverseActionWaitDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env["ADVERSE_ACTION_WAIT_DAYS"]?.trim();
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return ADVERSE_ACTION_WAIT_DAYS_DEFAULT;
  return Math.floor(parsed);
}

/**
 * Count whole business days (Mon–Fri) elapsed between `since` and `now`.
 * Federal holidays are NOT subtracted — this is a documented simplification;
 * counsel should confirm whether the waiting period needs to account for them.
 */
export function businessDaysElapsed(since: Date, now: Date = new Date()): number {
  const start = new Date(since);
  const end = new Date(now);
  if (end <= start) return 0;
  let days = 0;
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  // Count each weekday strictly after the start day up to and including today.
  cursor.setDate(cursor.getDate() + 1);
  while (cursor <= endDay) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6) days += 1;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export interface FcraAuthorizationState {
  fcraAuthorizedAt: Date | string | null | undefined;
  fcraDisclosureVersion: string | null | undefined;
}

/** True only when a written authorization exists under the CURRENT disclosure version. */
export function isFcraAuthorized(
  profile: FcraAuthorizationState | null | undefined,
): boolean {
  if (!profile?.fcraAuthorizedAt) return false;
  return profile.fcraDisclosureVersion === FCRA_DISCLOSURE_VERSION;
}

/** Throw FCRA_AUTHORIZATION_MISSING unless the washer has valid authorization. */
export function assertFcraAuthorization(
  profile: FcraAuthorizationState | null | undefined,
): void {
  if (!isFcraAuthorized(profile)) {
    throw new Error("FCRA_AUTHORIZATION_MISSING");
  }
}

export type AdverseActionStatus =
  | "flagged"
  | "pre_adverse_action"
  | "adverse_action_final";

/**
 * Allowed adverse-action transitions. Terminal states (cleared,
 * adverse_action_final) never regress. Kept as a pure map so it is unit
 * testable without a database.
 */
export const ADVERSE_ACTION_TRANSITIONS: Record<string, string[]> = {
  flagged: ["pre_adverse_action", "cleared"],
  pre_adverse_action: ["adverse_action_final", "cleared"],
  cleared: [],
  adverse_action_final: [],
};

export function getAllowedAdverseTransitions(fromStatus: string): string[] {
  return ADVERSE_ACTION_TRANSITIONS[fromStatus] ?? [];
}

export interface AdverseActionReadiness {
  allowed: boolean;
  businessDaysElapsed: number;
  waitDays: number;
  remainingBusinessDays: number;
}

/** Add N business days (Mon–Fri) to a date. Used for notice response deadlines. */
export function addBusinessDays(from: Date, businessDays: number): Date {
  const result = new Date(from);
  let added = 0;
  while (added < businessDays) {
    result.setDate(result.getDate() + 1);
    const dow = result.getDay();
    if (dow !== 0 && dow !== 6) added += 1;
  }
  return result;
}

/** Whether the final adverse decision may be recorded yet (waiting period enforced server-side). */
export function canCompleteAdverseAction(
  preAdverseSentAt: Date | string | null | undefined,
  waitDays: number = ADVERSE_ACTION_WAIT_DAYS_DEFAULT,
  now: Date = new Date(),
): AdverseActionReadiness {
  if (!preAdverseSentAt) {
    return { allowed: false, businessDaysElapsed: 0, waitDays, remainingBusinessDays: waitDays };
  }
  const elapsed = businessDaysElapsed(new Date(preAdverseSentAt), now);
  const remaining = Math.max(0, waitDays - elapsed);
  return { allowed: remaining === 0, businessDaysElapsed: elapsed, waitDays, remainingBusinessDays: remaining };
}

export interface FcraBusinessDetails {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  craName: string;
  craAddress: string;
  craPhone: string;
  /** False while any business detail is missing or still a placeholder — notices must not go out. */
  isConfigured: boolean;
}

const PLACEHOLDER_HINT = "CUSTOMIZE";

export function getFcraBusinessDetails(env: NodeJS.ProcessEnv = process.env): FcraBusinessDetails {
  const businessName = env["FCRA_BUSINESS_NAME"]?.trim() ?? "";
  const businessAddress = env["FCRA_BUSINESS_ADDRESS"]?.trim() ?? "";
  const businessPhone = env["FCRA_BUSINESS_PHONE"]?.trim() ?? "";
  const craName = env["FCRA_CRA_NAME"]?.trim() || "Checkr, Inc.";
  const craAddress = env["FCRA_CRA_ADDRESS"]?.trim() || "";
  const craPhone = env["FCRA_CRA_PHONE"]?.trim() || "";
  const looksPlaceholder = (v: string) => v === "" || v.toUpperCase().includes(PLACEHOLDER_HINT) || v.startsWith("[");
  return {
    businessName: businessName || "[BUSINESS NAME — CUSTOMIZE]",
    businessAddress: businessAddress || "[BUSINESS ADDRESS — CUSTOMIZE]",
    businessPhone: businessPhone || "[BUSINESS PHONE — CUSTOMIZE]",
    craName,
    craAddress: craAddress || "[CRA ADDRESS — CUSTOMIZE]",
    craPhone: craPhone || "[CRA PHONE — CUSTOMIZE]",
    isConfigured: ![businessName, businessAddress, businessPhone].some(looksPlaceholder),
  };
}
