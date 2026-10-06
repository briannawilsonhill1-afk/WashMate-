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
  };
  type CreateAccount = (params: any, options: { idempotencyKey: string }) => Promise<{ id: string }>;
  type UpdateAccount = (id: string, params: any) => Promise<{ id: string }>;
  type CreateExternalAccount = (
    id: string,
    params: any,
    options: { idempotencyKey: string },
  ) => Promise<{ id: string }>;
  type SetConnectAccount = (userId: string, accountId: string, bankAccountId: string) => Promise<void>;

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
  };
  return {
    profile,
    storage: {
      getWasherProfile: vi.fn(async () => ({ ...profile })),
      setStripeConnectAccountId: vi.fn<SetConnectAccount>(),
    },
    accountCreate: vi.fn<CreateAccount>(async () => ({ id: "acct_1" })),
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

describe("Connect account provisioning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    mocks.profile.stripeConnectAccountId = null;
    mocks.profile.stripeConnectBankAccountId = null;
    mocks.profile.stripeVerifiedAt = new Date("2026-01-01T00:00:00Z");
    mocks.profile.updatedAt = new Date("2026-01-01T00:00:00Z");
    mocks.accountCreate.mockResolvedValue({ id: "acct_1" });
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
      tos_acceptance: expect.objectContaining({ date: 1_767_225_600 }),
    });
    const createOptions = { idempotencyKey: "washmate_connect_account_washer_1" };
    expect(mocks.accountCreate).toHaveBeenNthCalledWith(1, createParams, createOptions);
    expect(mocks.accountCreate).toHaveBeenNthCalledWith(2, createParams, createOptions);
    const bankOptions = { idempotencyKey: "washmate_connect_bank_washer_1_fca_1" };
    expect(mocks.externalCreate).toHaveBeenNthCalledWith(1, "acct_1", expect.anything(), bankOptions);
    expect(mocks.externalCreate).toHaveBeenNthCalledWith(2, "acct_1", expect.anything(), bankOptions);
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