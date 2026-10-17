import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { users, washerProfiles } from "@workspace/db";
import { db, pool } from "./db";
import { DatabaseStorage } from "./storage";
import { WASHER_TOS_VERSION } from "./lib/tos";

// Requires DATABASE_URL (and FIELD_ENCRYPTION_KEY for the encrypted profile
// fields) — runs in CI, skipped implicitly when no database is configured.
describe.sequential("database-backed ToS acceptance evidence", () => {
  const storage = new DatabaseStorage();
  const createdUserIds: string[] = [];

  async function createUser() {
    const userId = `tos-test-${randomUUID()}`;
    await db.insert(users).values({ id: userId, email: `${userId}@example.com`, role: "washer" });
    createdUserIds.push(userId);
    return userId;
  }

  function profileInput(agreedToTerms: boolean) {
    return {
      userId: "",
      legalName: "Tos Tester",
      dateOfBirth: "1990-01-02",
      phone: "5555555555",
      taxId: "1234",
      agreedToTerms,
    };
  }

  afterEach(async () => {
    for (const userId of createdUserIds.splice(0)) {
      await db.delete(washerProfiles).where(eq(washerProfiles.userId, userId));
      await db.delete(users).where(eq(users.id, userId));
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("records timestamp, client IP and version when the washer first agrees", async () => {
    const userId = await createUser();

    const saved = await storage.upsertWasherProfile(
      { ...profileInput(true), userId },
      { clientIp: "203.0.113.7" },
    );

    expect(saved.agreedToTerms).toBe(true);
    expect(saved.tosAcceptedAt).toBeInstanceOf(Date);
    expect(saved.tosAcceptedIp).toBe("203.0.113.7");
    expect(saved.tosVersion).toBe(WASHER_TOS_VERSION);
  });

  it("does not overwrite evidence while the washer stays agreed", async () => {
    const userId = await createUser();
    const first = await storage.upsertWasherProfile(
      { ...profileInput(true), userId },
      { clientIp: "203.0.113.7" },
    );

    const second = await storage.upsertWasherProfile(
      { ...profileInput(true), userId, phone: "5555555556" },
      { clientIp: "198.51.100.9" },
    );

    expect(second.tosAcceptedIp).toBe("203.0.113.7");
    expect(second.tosAcceptedAt?.getTime()).toBe(first.tosAcceptedAt?.getTime());
  });

  it("re-records evidence after withdrawal and re-agreement", async () => {
    const userId = await createUser();
    await storage.upsertWasherProfile({ ...profileInput(true), userId }, { clientIp: "203.0.113.7" });
    await storage.upsertWasherProfile({ ...profileInput(false), userId }, { clientIp: "203.0.113.7" });

    const reAgreed = await storage.upsertWasherProfile(
      { ...profileInput(true), userId },
      { clientIp: "198.51.100.9" },
    );

    expect(reAgreed.agreedToTerms).toBe(true);
    expect(reAgreed.tosAcceptedIp).toBe("198.51.100.9");
    expect(reAgreed.tosVersion).toBe(WASHER_TOS_VERSION);
  });
});
