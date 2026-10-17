import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  type MockProfile = {
    userId: string;
    stripeBankAccountId: string;
    stripeConnectAccountId: string | null;
    stripeConnectBankAccountId: string | null;
    legalName: string;
    dateOfBirth: string;
    phone: string;
    taxId: string;
    state: string;
    county: string;
    stripeVerifiedAt: Date;
    updatedAt: Date;
    agreedToTerms: boolean;
    tosAcceptedAt: Date | null;
    tosAcceptedIp: string | null;
    tosVersion: string | null;
  };
  type CreateAccount = (params: any, options: { idempotencyKey: string }) => Promise<{ id: string; metadata?: Record<string, string> }>;
  type ListAccounts = (params: any) => Promise<{ data: Array<{ id: string; metadata?: Record<string, string> }> }>;
  type UpdateAccount = (id: string, params: any) => Promise<{ id: string }>;
  type CreateExternalAccount = (
    id: string,
    params: any,
    options: { idempotencyKey: string },
  ) => Promise<{ id: string }>;
  type SetConnectAccount = (userId: string, accountId: string, bankAccountId: string) => Promise<void>;
  type RecordTosAcceptance = (userId: string, evidence: { ip: string; version: string }) => Promise<void>;

  const profile: MockProfile = {
    userId: "washer_1",
    stripeBankAccountId: "fca_1",
    stripeConnectAccountId: null,
    stripeConnectBankAccountId: null,
    legalName: "Wash Er",
    dateOfBirth: "1990-01-02",
    phone: "5555555555",
    taxId: "1234",
    state: "HI",
    county: "Honolulu",
    stripeVerifiedAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    agreedToTerms: true,
    tosAcceptedAt: new Date("2026-01-01T00:00:00Z"),
    tosAcceptedIp: "203.0.113.7",
    tosVersion: "1.0",
  };
  return {
    profile,
    storage: {
      getWasherProfile: vi.fn(async () => ({ ...profile })),
      setStripeConnectAccountId: vi.fn<SetConnectAccount>(),
      recordTosAcceptance: vi.fn<RecordTosAcceptance>(async () => {}),
    },
    accountCreate: vi.fn<CreateAccount>(async () => ({ id: "acct_1" })),
    accountList: vi.fn<ListAccounts>(async () => ({ data: [] })),
    accountUpdate: vi.fn<UpdateAccount>(async () => ({ id: "acct_1" })),
    externalCreate: vi.fn<CreateExternalAccount>(async () => ({ id: "ba_1" })),
    poolConnect: vi.fn<() => Promise<any>>(),
  };
});

vi.mock("./storage", () => ({ storage: mocks.storage }));
vi.mock("./stripeClient", () => ({
  getUncachableStripeClient: vi.fn(async () => ({
    accounts: {
      create: mocks.accountCreate,
      list: mocks.accountList,
      update: mocks.accountUpdate,
      createExternalAccount: mocks.externalCreate,
    },
  })),
}));
vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn(async () => ({ emailAddresses: [] })) } },
}));
vi.mock("./db", () => ({ pool: { connect: mocks.poolConnect } }));
vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { ensureConnectAccount } from "./payoutService";
import { WASHER_TOS_VERSION } from "./lib/tos";

describe("Connect account provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env["STRIPE_CONNECT_ACCOUNT_TYPE"];
    let held = Promise.resolve();
    mocks.poolConnect.mockImplementation(async () => {
      let release!: () => void;
      return {
        query: vi.fn(async (sql: string) => {
          if (sql.includes("pg_advisory_lock")) {
            const previous = held;
            held = new Promise<void>((resolve) => { release = resolve; });
            await previous;
          } else if (sql.includes("pg_advisory_unlock")) {
            release();
          }
        }),
        release: vi.fn(),
      };
    });
    mocks.storage.getWasherProfile.mockImplementation(async () => ({ ...mocks.profile }));
    mocks.storage.setStripeConnectAccountId.mockImplementation(async (_userId, accountId, bankAccountId) => {
      mocks.profile.stripeConnectAccountId = accountId;
      mocks.profile.stripeConnectBankAccountId = bankAccountId;
    });
    mocks.storage.recordTosAcceptance.mockImplementation(async (_userId, evidence) => {
      mocks.profile.tosAcceptedAt = new Date();
      mocks.profile.tosAcceptedIp = evidence.ip;
      mocks.profile.tosVersion = evidence.version;
    });
    mocks.profile.stripeConnectAccountId = null;
    mocks.profile.stripeConnectBankAccountId = null;
    mocks.profile.stripeVerifiedAt = new Date("2026-01-01T00:00:00Z");
    mocks.profile.updatedAt = new Date("2026-01-01T00:00:00Z");
    mocks.profile.agreedToTerms = true;
    mocks.profile.tosAcceptedAt = new Date("2026-01-01T00:00:00Z");
    mocks.profile.tosAcceptedIp = "203.0.113.7";
    mocks.profile.tosVersion = WASHER_TOS_VERSION;
    mocks.accountCreate.mockResolvedValue({ id: "acct_1" });
    mocks.accountList.mockResolvedValue({ data: [] });
    mocks.externalCreate.mockResolvedValue({ id: "ba_1" });
  });

  it("serializes concurrent creation and configures manual payouts", async () => {
    const [first, second] = await Promise.all([
      ensureConnectAccount("washer_1"),
      ensureConnectAccount("washer_1"),
    ]);

    expect(first).toBe("acct_1");
    expect(second).toBe("acct_1");
    expect(mocks.accountCreate).toHaveBeenCalledTimes(1);
    expect(mocks.accountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: { payouts: { schedule: { interval: "manual" } } },
      }),
      { idempotencyKey: "washmate_connect_account_washer_1" },
    );
  });

  it("sends real ToS acceptance evidence instead of a loopback IP", async () => {
    await ensureConnectAccount("washer_1");

    expect(mocks.accountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tos_acceptance: expect.objectContaining({
          date: 1_767_225_600,
          ip: "203.0.113.7",
          service_agreement: "recipient",
        }),
      }),
      expect.anything(),
    );
    const tosIp = mocks.accountCreate.mock.calls[0][0].tos_acceptance.ip;
    expect(tosIp).not.toBe("127.0.0.1");
  });

  it("reuses deterministic Stripe operations after local persistence fails", async () => {
    mocks.storage.setStripeConnectAccountId
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockImplementationOnce(async (_userId, accountId, bankAccountId) => {
        mocks.profile.stripeConnectAccountId = accountId;
        mocks.profile.stripeConnectBankAccountId = bankAccountId;
      });

    await expect(ensureConnectAccount("washer_1")).rejects.toThrow("database unavailable");
    await expect(ensureConnectAccount("washer_1")).resolves.toBe("acct_1");

    expect(mocks.accountCreate).toHaveBeenCalledTimes(2);
    const createParams = expect.objectContaining({
      tos_acceptance: expect.objectContaining({ date: 1_767_225_600, ip: "203.0.113.7" }),
    });
    const createOptions = { idempotencyKey: "washmate_connect_account_washer_1" };
    expect(mocks.accountCreate).toHaveBeenNthCalledWith(1, createParams, createOptions);
    expect(mocks.accountCreate).toHaveBeenNthCalledWith(2, createParams, createOptions);
    const bankOptions = { idempotencyKey: "washmate_connect_bank_washer_1_fca_1" };
    expect(mocks.externalCreate).toHaveBeenNthCalledWith(1, "acct_1", expect.anything(), bankOptions);
    expect(mocks.externalCreate).toHaveBeenNthCalledWith(2, "acct_1", expect.anything(), bankOptions);
  });

  it("adopts an orphaned Stripe account instead of creating a duplicate", async () => {
    // Simulates: Stripe create succeeded >24h ago (idempotency key expired)
    // but the local id was never persisted.
    mocks.accountList.mockResolvedValue({
      data: [{ id: "acct_orphan", metadata: { washmateUserId: "washer_1" } }],
    });

    await expect(ensureConnectAccount("washer_1")).resolves.toBe("acct_orphan");

    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.externalCreate).toHaveBeenCalledWith(
      "acct_orphan",
      { external_account: "fca_1", default_for_currency: true },
      { idempotencyKey: "washmate_connect_bank_washer_1_fca_1" },
    );
    expect(mocks.storage.setStripeConnectAccountId).toHaveBeenCalledWith(
      "washer_1",
      "acct_orphan",
      "fca_1",
    );
  });

  it("fails closed when ToS acceptance evidence is missing", async () => {
    mocks.profile.agreedToTerms = false;
    mocks.profile.tosAcceptedAt = null;
    mocks.profile.tosAcceptedIp = null;
    mocks.profile.tosVersion = null;

    await expect(ensureConnectAccount("washer_1")).rejects.toMatchObject({
      code: "TOS_EVIDENCE_MISSING",
    });
    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.accountList).not.toHaveBeenCalled();
  });

  it("records fresh evidence for legacy washers when a real client IP is available", async () => {
    mocks.profile.tosAcceptedAt = null;
    mocks.profile.tosAcceptedIp = null;
    mocks.profile.tosVersion = null;

    await expect(
      ensureConnectAccount("washer_1", { clientIp: "198.51.100.9" }),
    ).resolves.toBe("acct_1");

    expect(mocks.storage.recordTosAcceptance).toHaveBeenCalledWith("washer_1", {
      ip: "198.51.100.9",
      version: WASHER_TOS_VERSION,
    });
    expect(mocks.accountCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        tos_acceptance: expect.objectContaining({ ip: "198.51.100.9" }),
      }),
      expect.anything(),
    );
  });

  it("fails fast when hosted (express) onboarding is selected but unimplemented", async () => {
    process.env["STRIPE_CONNECT_ACCOUNT_TYPE"] = "express";

    await expect(ensureConnectAccount("washer_1")).rejects.toMatchObject({
      code: "CONNECT_MODEL_NOT_SUPPORTED",
    });
    expect(mocks.accountCreate).not.toHaveBeenCalled();
  });

  it("forces existing Connect accounts onto a manual payout schedule", async () => {
    mocks.profile.stripeConnectAccountId = "acct_existing";
    mocks.profile.stripeConnectBankAccountId = "fca_1";

    await expect(ensureConnectAccount("washer_1")).resolves.toBe("acct_existing");

    expect(mocks.accountCreate).not.toHaveBeenCalled();
    expect(mocks.accountUpdate).toHaveBeenCalledWith("acct_existing", {
      settings: { payouts: { schedule: { interval: "manual" } } },
    });
  });

  it("makes a newly verified bank the Connect account default", async () => {
    mocks.profile.stripeConnectAccountId = "acct_existing";
    mocks.profile.stripeConnectBankAccountId = "fca_old";

    await ensureConnectAccount("washer_1");

    expect(mocks.externalCreate).toHaveBeenCalledWith(
      "acct_existing",
      { external_account: "fca_1", default_for_currency: true },
      { idempotencyKey: "washmate_connect_bank_washer_1_fca_1" },
    );
    expect(mocks.storage.setStripeConnectAccountId).toHaveBeenCalledWith(
      "washer_1",
      "acct_existing",
      "fca_1",
    );
  });
});
