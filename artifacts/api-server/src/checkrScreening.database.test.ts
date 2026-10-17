import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, washerProfiles, washerBgCheckEvents } from "@workspace/db";
import { db, pool } from "./db";
import { DatabaseStorage } from "./storage";
import { FCRA_DISCLOSURE_VERSION } from "./lib/fcra";

// Requires DATABASE_URL (and FIELD_ENCRYPTION_KEY for the encrypted profile
// fields) — runs in CI, skipped implicitly when no database is configured.
describe.sequential("database-backed Checkr screening workflow", () => {
  const storage = new DatabaseStorage();
  const createdUserIds: string[] = [];

  async function createUser() {
    const userId = `checkr-test-${randomUUID()}`;
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, role: "washer" });
    createdUserIds.push(userId);
    return userId;
  }

  function consentInput(userId: string) {
    return {
      userId,
      legalName: "Checkr Tester",
      dateOfBirth: "1990-01-02",
      phone: "5555555555",
      taxId: "1234",
      bgCheckConsent: true,
      bgSelfCertify: true,
      county: "Wyandotte",
      state: "KS",
    };
  }


  async function authorizeWasher(userId: string) {
    // Written FCRA authorization is recorded server-side and completes the
    // screening submission when the profile is otherwise complete.
    return storage.recordFcraAuthorization(userId, {
      ip: "203.0.113.1",
      version: FCRA_DISCLOSURE_VERSION,
    });
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

  it("moves a consenting washer to pending and records the Checkr request", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(consentInput(userId));
    const authorized = await authorizeWasher(userId);
    expect(authorized.bgCheckStatus).toBe("pending");

    await storage.setCheckrScreeningRequest(userId, { candidateId: "cand_db_1", invitationId: "inv_db_1" });
    const found = await storage.getWasherProfileByCheckrCandidateId("cand_db_1");
    expect(found?.userId).toBe(userId);
    expect(found?.bgCheckProvider).toBe("checkr");
    expect(found?.checkrInvitationId).toBe("inv_db_1");
    expect(found?.bgCheckRequestedAt).toBeInstanceOf(Date);
    // Still pending — requesting a screening never decides it.
    expect(found?.bgCheckStatus).toBe("pending");
  });

  it("returns undefined for an unknown candidate", async () => {
    expect(await storage.getWasherProfileByCheckrCandidateId("cand_nope")).toBeUndefined();
  });

  it("records a provider decision with coarse result and audit event", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(consentInput(userId));
    await authorizeWasher(userId);
    await storage.setCheckrScreeningRequest(userId, { candidateId: "cand_db_2", invitationId: "inv_db_2" });

    const decided = await storage.transitionWasherBgCheck(userId, {
      toStatus: "cleared",
      actorType: "provider",
      actorId: "checkr",
      providerReference: "rep_db_1",
      reasonCode: "provider_cleared",
      decision: { result: "clear", reportId: "rep_db_1" },
    });
    expect(decided.bgCheckStatus).toBe("cleared");
    expect(decided.checkrReportId).toBe("rep_db_1");
    expect(decided.bgCheckResult).toBe("clear");
    expect(decided.bgCheckDecidedAt).toBeInstanceOf(Date);

    const events = await storage.getWasherBgCheckEvents(userId);
    const decision = events.find((e) => e.toStatus === "cleared");
    expect(decision?.actorType).toBe("provider");
    expect(decision?.providerReference).toBe("rep_db_1");
  });

  it("refuses a second decision on an already-decided screening", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(consentInput(userId));
    await authorizeWasher(userId);
    await storage.transitionWasherBgCheck(userId, {
      toStatus: "cleared",
      actorId: "checkr",
      actorType: "provider",
      providerReference: "rep_db_2",
      reasonCode: "provider_cleared",
      decision: { result: "clear", reportId: "rep_db_2" },
    });
    await expect(
      storage.transitionWasherBgCheck(userId, {
        toStatus: "flagged",
        actorId: "checkr",
        actorType: "provider",
        providerReference: "rep_db_3",
        reasonCode: "provider_flagged",
        decision: { result: "consider", reportId: "rep_db_3" },
      }),
    ).rejects.toThrow("BG_CHECK_NOT_PENDING");
  });

  it("clears only the matching pending invitation", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(consentInput(userId));
    await authorizeWasher(userId);
    await storage.setCheckrScreeningRequest(userId, { candidateId: "cand_db_4", invitationId: "inv_db_4" });

    expect(await storage.clearCheckrInvitation(userId, "inv_other")).toBe(false);
    expect(await storage.clearCheckrInvitation(userId, "inv_db_4")).toBe(true);
    const profile = await storage.getWasherProfile(userId);
    expect(profile?.checkrInvitationId).toBeNull();
    expect(profile?.bgCheckStatus).toBe("pending");
    // Candidate linkage survives so the next invitation reuses the candidate.
    expect(profile?.checkrCandidateId).toBe("cand_db_4");
  });

  it("does not clear the invitation of a decided screening", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile(consentInput(userId));
    await authorizeWasher(userId);
    await storage.setCheckrScreeningRequest(userId, { candidateId: "cand_db_5", invitationId: "inv_db_5" });
    await storage.transitionWasherBgCheck(userId, {
      toStatus: "flagged",
      actorId: "checkr",
      actorType: "provider",
      providerReference: "rep_db_5",
      reasonCode: "provider_flagged",
      decision: { result: "consider", reportId: "rep_db_5" },
    });
    expect(await storage.clearCheckrInvitation(userId, "inv_db_5")).toBe(false);
  });
});
