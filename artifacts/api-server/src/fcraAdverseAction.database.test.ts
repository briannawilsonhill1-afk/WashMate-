import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, washerProfiles, washerBgCheckEvents } from "@workspace/db";
import { db, pool } from "./db";
import { DatabaseStorage } from "./storage";
import { FCRA_DISCLOSURE_VERSION } from "./lib/fcra";

// Requires DATABASE_URL (and FIELD_ENCRYPTION_KEY for the encrypted profile
// fields) — runs in CI, skipped implicitly when no database is configured.
describe.sequential("database-backed FCRA authorization and adverse-action workflow", () => {
  const storage = new DatabaseStorage();
  const createdUserIds: string[] = [];

  async function createUser() {
    const userId = `fcra-test-${randomUUID()}`;
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, role: "washer" });
    createdUserIds.push(userId);
    return userId;
  }

  function profileInput(userId: string, consent: boolean) {
    return {
      userId,
      legalName: "FCRA Tester",
      dateOfBirth: "1990-01-02",
      phone: "5555555555",
      taxId: "1234",
      bgCheckConsent: consent,
      bgSelfCertify: true,
      county: "Wyandotte",
      state: "KS",
    };
  }

  async function flaggedWasher() {
    const userId = await createUser();
    await storage.upsertWasherProfile(profileInput(userId, true));
    // Written FCRA authorization completes the submission (not_started -> pending).
    await storage.recordFcraAuthorization(userId, { ip: "203.0.113.1", version: FCRA_DISCLOSURE_VERSION });
    await storage.transitionWasherBgCheck(userId, {
      toStatus: "flagged",
      actorId: "checkr",
      actorType: "provider",
      providerReference: "rep_fcra_1",
      reasonCode: "provider_flagged",
      decision: { result: "consider", reportId: "rep_fcra_1" },
    });
    return userId;
  }

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(washerBgCheckEvents).where(eq(washerBgCheckEvents.washerId, userId));
      await db.delete(washerProfiles).where(eq(washerProfiles.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("does not submit screening on profile save without FCRA authorization", async () => {
    // The legacy client consent flag alone no longer submits a screening.
    const userId = await createUser();
    const saved = await storage.upsertWasherProfile(profileInput(userId, true));
    expect(saved.bgCheckStatus).toBe("not_started");
  });

  it("never lets a stale form save revoke a recorded authorization", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(profileInput(userId, true));
    await storage.recordFcraAuthorization(userId, { ip: "203.0.113.1", version: FCRA_DISCLOSURE_VERSION });

    // A stale client save carrying bgCheckConsent=false cannot revoke the
    // server-recorded authorization or regress the submitted screening.
    const resaved = await storage.upsertWasherProfile(profileInput(userId, false));
    expect(resaved.bgCheckConsent).toBe(true);
    expect(resaved.fcraAuthorizedAt).toBeInstanceOf(Date);
    expect(resaved.fcraDisclosureVersion).toBe(FCRA_DISCLOSURE_VERSION);
    expect(resaved.bgCheckStatus).toBe("pending");
  });

  it("records FCRA authorization with version, timestamp, and IP", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(profileInput(userId, false));

    const authed = await storage.recordFcraAuthorization(userId, {
      ip: "203.0.113.7",
      version: FCRA_DISCLOSURE_VERSION,
    });
    expect(authed.fcraDisclosureVersion).toBe(FCRA_DISCLOSURE_VERSION);
    expect(authed.fcraAuthorizedAt).toBeInstanceOf(Date);
    expect(authed.fcraAuthorizedIp).toBe("203.0.113.7");
    // Authorization and the screening consent flag can never disagree.
    expect(authed.bgCheckConsent).toBe(true);

    const events = await storage.getWasherBgCheckEvents(userId);
    const authEvent = events.find((e) => e.reasonCode === "fcra_authorized");
    expect(authEvent?.actorType).toBe("washer");
    expect(authEvent?.toStatus).toBe(authed.bgCheckStatus);
  });

  it("is idempotent for re-authorization under the current version", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(profileInput(userId, false));

    const first = await storage.recordFcraAuthorization(userId, { ip: "203.0.113.7", version: FCRA_DISCLOSURE_VERSION });
    const second = await storage.recordFcraAuthorization(userId, { ip: "203.0.113.7", version: FCRA_DISCLOSURE_VERSION });
    expect(second.fcraAuthorizedAt).toEqual(first.fcraAuthorizedAt);
  });

  it("moves flagged -> pre_adverse_action with notice metadata and admin audit", async () => {
    const userId = await flaggedWasher();
    const updated = await storage.transitionAdverseAction(userId, {
      toStatus: "pre_adverse_action",
      actorId: "admin_1",
      reasonCode: "pre_adverse_notice_sent",
      noticeVersion: "1.0",
      waitDays: 5,
    });
    expect(updated.bgCheckStatus).toBe("pre_adverse_action");
    expect(updated.preAdverseSentAt).toBeInstanceOf(Date);
    expect(updated.preAdverseNoticeVersion).toBe("1.0");

    const events = await storage.getWasherBgCheckEvents(userId);
    const transition = events.find((e) => e.toStatus === "pre_adverse_action");
    expect(transition?.actorType).toBe("admin");
    expect(transition?.fromStatus).toBe("flagged");
    expect(transition?.actorId).toBe("admin_1");
  });

  it("blocks completing the adverse action before the waiting period elapses", async () => {
    const userId = await flaggedWasher();
    await storage.transitionAdverseAction(userId, {
      toStatus: "pre_adverse_action",
      actorId: "admin_1",
      reasonCode: "pre_adverse_notice_sent",
      waitDays: 5,
    });
    await expect(
      storage.transitionAdverseAction(userId, {
        toStatus: "adverse_action_final",
        actorId: "admin_1",
        reasonCode: "adverse_action_final",
        waitDays: 5,
      }),
    ).rejects.toThrow("ADVERSE_ACTION_WAIT_NOT_ELAPSED");

    // Status is unchanged after the blocked attempt.
    const profile = await storage.getWasherProfile(userId);
    expect(profile?.bgCheckStatus).toBe("pre_adverse_action");
  });

  it("completes the adverse action after the waiting period elapses", async () => {
    const userId = await flaggedWasher();
    // Pre-adverse sent Monday 2026-10-12; completing Monday 2026-10-19
    // (5 business days later) is allowed.
    await storage.transitionAdverseAction(userId, {
      toStatus: "pre_adverse_action",
      actorId: "admin_1",
      reasonCode: "pre_adverse_notice_sent",
      noticeVersion: "1.0",
      waitDays: 5,
      now: new Date("2026-10-12T09:00:00"),
    });
    const final = await storage.transitionAdverseAction(userId, {
      toStatus: "adverse_action_final",
      actorId: "admin_1",
      reasonCode: "adverse_action_final",
      noticeVersion: "1.0",
      waitDays: 5,
      now: new Date("2026-10-19T09:00:00"),
    });
    expect(final.bgCheckStatus).toBe("adverse_action_final");
    expect(final.adverseActionFinalAt).toBeInstanceOf(Date);
    expect(final.adverseActionNoticeVersion).toBe("1.0");
  });

  it("clears a flagged washer when a dispute resolves", async () => {
    const userId = await flaggedWasher();
    const cleared = await storage.transitionAdverseAction(userId, {
      toStatus: "cleared",
      actorId: "admin_1",
      reasonCode: "dispute_resolved",
    });
    expect(cleared.bgCheckStatus).toBe("cleared");
  });

  it("never regresses the terminal adverse_action_final state", async () => {
    const userId = await flaggedWasher();
    await storage.transitionAdverseAction(userId, {
      toStatus: "pre_adverse_action",
      actorId: "admin_1",
      reasonCode: "pre_adverse_notice_sent",
      waitDays: 5,
      now: new Date("2026-10-12T09:00:00"),
    });
    await storage.transitionAdverseAction(userId, {
      toStatus: "adverse_action_final",
      actorId: "admin_1",
      reasonCode: "adverse_action_final",
      waitDays: 5,
      now: new Date("2026-10-19T09:00:00"),
    });
    await expect(
      storage.transitionAdverseAction(userId, { toStatus: "cleared", actorId: "admin_1", reasonCode: "x" }),
    ).rejects.toThrow("ADVERSE_ACTION_TRANSITION_NOT_ALLOWED");
    await expect(
      storage.transitionAdverseAction(userId, { toStatus: "pre_adverse_action", actorId: "admin_1", reasonCode: "x" }),
    ).rejects.toThrow("ADVERSE_ACTION_TRANSITION_NOT_ALLOWED");
  });

  it("rejects adverse-action transitions from non-flagged states", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(profileInput(userId, true)); // lands in pending
    await expect(
      storage.transitionAdverseAction(userId, { toStatus: "pre_adverse_action", actorId: "admin_1", reasonCode: "x" }),
    ).rejects.toThrow("ADVERSE_ACTION_TRANSITION_NOT_ALLOWED");
  });

  it("exposes adverse-action readiness via getAdverseActionInfo", async () => {
    const userId = await flaggedWasher();
    const before = await storage.getAdverseActionInfo(userId, 5);
    expect(before?.bgCheckStatus).toBe("flagged");
    expect(before?.readiness.allowed).toBe(false);

    await storage.transitionAdverseAction(userId, {
      toStatus: "pre_adverse_action",
      actorId: "admin_1",
      reasonCode: "pre_adverse_notice_sent",
      waitDays: 5,
    });
    const after = await storage.getAdverseActionInfo(userId, 5);
    expect(after?.preAdverseSentAt).toBeInstanceOf(Date);
    expect(after?.readiness.allowed).toBe(false); // just sent — still waiting
    expect(after?.readiness.remainingBusinessDays).toBe(5);
  });
});
