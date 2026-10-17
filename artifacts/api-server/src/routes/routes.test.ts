import type { Express } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getUser: vi.fn(),
    getWasherProfile: vi.fn(),
    getWasherBgCheckStatus: vi.fn(),
    getWasherEarnings: vi.fn(),
    transitionWasherBgCheck: vi.fn(),
    resubmitWasherBgCheck: vi.fn(),
    getWasherBgCheckEvents: vi.fn(),
    recordFcraAuthorization: vi.fn(),
    transitionAdverseAction: vi.fn(),
    getAdverseActionInfo: vi.fn(),
    getStripeCustomerId: vi.fn(),
    attachStripeBankAccount: vi.fn(),
    requestPayout: vi.fn(),
  },
  executePayout: vi.fn(),
  getUncachableStripeClient: vi.fn(),
  getStripePublishableKey: vi.fn(),
  registerIncidentRoutes: vi.fn(),
  startWasherScreening: vi.fn(),
  getCheckrConfig: vi.fn(),
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));

vi.mock("@clerk/express", () => ({ clerkClient: mocks.clerkClient }));

vi.mock("../lib/checkr", () => ({
  startWasherScreening: mocks.startWasherScreening,
  getCheckrConfig: mocks.getCheckrConfig,
}));

vi.mock("../auth", () => ({
  isAuthenticated: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
  getUserId: vi.fn(() => "washer_1"),
  toPublicUser: vi.fn(),
}));

vi.mock("../stripeClient", () => ({
  getUncachableStripeClient: mocks.getUncachableStripeClient,
  getStripePublishableKey: mocks.getStripePublishableKey,
}));

vi.mock("../payoutService", () => ({
  executePayout: mocks.executePayout,
  ensureConnectAccount: vi.fn(),
  PayoutError: class PayoutError extends Error {},
    WASHER_PAYOUT_FAILURE_REASON: "Payout could not be sent to your bank. Please try again.",
}));

vi.mock("../push", () => ({
  registerDeviceToken: vi.fn(),
  unregisterDeviceToken: vi.fn(),
  notifyClearedWashersOfNewOrder: vi.fn(),
  notifyOrderStatusChange: vi.fn(),
}));

vi.mock("../customerUnlock", () => ({
  CUSTOMER_UNLOCK_AMOUNT_CENTS: 100,
  CUSTOMER_UNLOCK_CURRENCY: "usd",
  CustomerUnlockError: class CustomerUnlockError extends Error {},
  CustomerUnlockService: class CustomerUnlockService {},
}));

vi.mock("../incidents", () => ({
  registerIncidentRoutes: mocks.registerIncidentRoutes,
}));

import { registerRoutes } from "./routes";

type Handler = (req: any, res: any, next?: (error?: unknown) => void) => unknown;

function createRouteApp() {
  const registered = new Map<string, Handler[]>();
  const register = (path: string, ...handlers: Handler[]) => {
    registered.set(path, handlers);
  };

  const app = {
    get: register,
    post: register,
    patch: register,
    delete: register,
  } as unknown as Express;

  return { app, registered };
}

function createResponse() {
  let statusCode = 200;
  let body: unknown;

  const response = {
    status: vi.fn((code: number) => {
      statusCode = code;
      return response;
    }),
    json: vi.fn((payload: unknown) => {
      body = payload;
      return response;
    }),
  };

  return {
    response,
    get statusCode() {
      return statusCode;
    },
    get body() {
      return body;
    },
  };
}

async function invokeRoute(
  handlers: Handler[],
  body: unknown,
  log: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> },
  params: Record<string, string> = {},
) {
  const result = createResponse();
  const req = { body, log, params };

  for (const handler of handlers) {
    if (handler.length >= 3) {
      await new Promise<void>((resolve, reject) => {
        handler(req, result.response, (error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    } else {
      await handler(req, result.response);
      break;
    }
  }

  return result;
}

describe("washer screening decisions", () => {
  afterEach(() => {
    delete process.env.WASHMATE_ADMIN_USER_IDS;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WASHMATE_ADMIN_USER_IDS = "washer_1";
    mocks.storage.transitionWasherBgCheck.mockResolvedValue({
      userId: "washer_target",
      bgCheckStatus: "cleared",
    });
    mocks.storage.resubmitWasherBgCheck.mockResolvedValue({
      userId: "washer_target",
      bgCheckStatus: "pending",
    });
    mocks.storage.getWasherBgCheckEvents.mockResolvedValue([
      {
        id: 1,
        washerId: "washer_target",
        fromStatus: "pending",
        toStatus: "cleared",
        actorType: "operator",
        actorId: "washer_1",
        providerReference: "provider-case-1",
        reasonCode: "provider_cleared",
        createdAt: new Date("2026-09-23T00:00:00.000Z"),
      },
    ]);
  });

  it("prevents washers outside the operator allowlist from recording decisions", async () => {
    process.env.WASHMATE_ADMIN_USER_IDS = "another_operator";
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/decision")!,
      { toStatus: "cleared", reasonCode: "provider_cleared" },
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({ message: "Admin only" });
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("records a provider failure through the authorized operator workflow", async () => {
    mocks.storage.transitionWasherBgCheck.mockResolvedValue({
      userId: "washer_target",
      bgCheckStatus: "provider_failed",
    });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/decision")!,
      {
        toStatus: "provider_failed",
        reasonCode: "provider_failed",
        providerReference: "provider-case-1",
      },
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      userId: "washer_target",
      bgCheckStatus: "provider_failed",
    });
    expect(mocks.storage.transitionWasherBgCheck).toHaveBeenCalledExactlyOnceWith(
      "washer_target",
      {
        toStatus: "provider_failed",
        reasonCode: "provider_failed",
        providerReference: "provider-case-1",
        actorId: "washer_1",
      },
    );
  });

  it("rejects a provider result that does not match the requested status", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/decision")!,
      {
        toStatus: "cleared",
        reasonCode: "provider_failed",
        providerReference: "provider-case-1",
      },
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({
      message: "Screening status and provider result do not match.",
      field: "reasonCode",
    });
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("allows an operator to resubmit only after a flagged or provider-failed result", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/resubmit")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({
      userId: "washer_target",
      bgCheckStatus: "pending",
    });
    expect(mocks.storage.resubmitWasherBgCheck).toHaveBeenCalledExactlyOnceWith(
      "washer_target",
      "washer_1",
    );
  });

  it("exposes only the screening audit record to authorized operators", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/events")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual([
      expect.objectContaining({
        washerId: "washer_target",
        fromStatus: "pending",
        toStatus: "cleared",
        actorType: "operator",
        reasonCode: "provider_cleared",
      }),
    ]);
    expect(mocks.storage.getWasherBgCheckEvents).toHaveBeenCalledExactlyOnceWith("washer_target");
  });
});

describe("FCRA screening routes", () => {
  const bodyOf = (result: { body: unknown }) => result.body as Record<string, any>;

  afterEach(() => {
    delete process.env.WASHMATE_ADMIN_USER_IDS;
    delete process.env.FCRA_BUSINESS_NAME;
    delete process.env.FCRA_BUSINESS_ADDRESS;
    delete process.env.FCRA_BUSINESS_PHONE;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WASHMATE_ADMIN_USER_IDS = "washer_1";
    mocks.storage.getUser.mockResolvedValue({ id: "washer_1", role: "washer" });
  });

  it("serves the versioned standalone disclosure text", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/fcra-disclosure")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result).version).toBe("1.0");
    expect(bodyOf(result).text).toContain("DISCLOSURE REGARDING BACKGROUND INVESTIGATION");
    expect(bodyOf(result).text.toLowerCase()).not.toContain("terms of service");
  });

  it("records the washer's written authorization", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue({
      userId: "washer_1",
      bgCheckStatus: "not_started",
      bgSelfCertify: true,
      county: "Wyandotte",
      state: "KS",
    });
    mocks.storage.recordFcraAuthorization.mockResolvedValue({
      userId: "washer_1",
      fcraDisclosureVersion: "1.0",
      fcraAuthorizedAt: new Date("2026-10-16T00:00:00.000Z"),
      bgCheckStatus: "pending",
      state: "KS",
    });
    mocks.clerkClient.users.getUser.mockResolvedValue({ emailAddresses: [{ emailAddress: "w@example.com" }] });
    mocks.getCheckrConfig.mockReturnValue({ apiKey: "x", packageSlug: "y", webhookSecrets: ["z"] });
    mocks.startWasherScreening.mockResolvedValue({ candidateId: "cand_1", invitationId: "inv_1", invitationReused: false });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/fcra-authorize")!,
      { authorized: true },
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result).authorized).toBe(true);
    expect(bodyOf(result).bgCheckStatus).toBe("pending");
    expect(mocks.storage.recordFcraAuthorization).toHaveBeenCalledExactlyOnceWith(
      "washer_1",
      { ip: null, version: "1.0" },
    );
    // Authorizing a complete profile submits the screening and starts Checkr.
    expect(mocks.startWasherScreening).toHaveBeenCalledExactlyOnceWith(
      { userId: "washer_1", email: "w@example.com", state: "KS" },
    );
  });

  it("rejects authorization without explicit confirmation", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/fcra-authorize")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(400);
    expect(mocks.storage.recordFcraAuthorization).not.toHaveBeenCalled();
  });

  it("rejects authorization for non-washers", async () => {    mocks.storage.getUser.mockResolvedValue({ id: "washer_1", role: "customer" });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/fcra-authorize")!,
      { authorized: true },
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(403);
    expect(mocks.storage.recordFcraAuthorization).not.toHaveBeenCalled();
  });

  it("requires a saved profile before authorization", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(undefined);
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/fcra-authorize")!,
      { authorized: true },
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(404);
    expect(mocks.storage.recordFcraAuthorization).not.toHaveBeenCalled();
  });

  it("maps FCRA_AUTHORIZATION_MISSING to a clear 409 on resend-invitation", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue({ state: "KS", bgCheckStatus: "pending" });
    mocks.clerkClient.users.getUser.mockResolvedValue({ emailAddresses: [{ emailAddress: "w@example.com" }] });
    mocks.getCheckrConfig.mockReturnValue({ apiKey: "x", packageSlug: "y", webhookSecrets: ["z"] });
    mocks.startWasherScreening.mockRejectedValue(new Error("FCRA_AUTHORIZATION_MISSING"));
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer/screening/resend-invitation")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(409);
    expect(bodyOf(result).code).toBe("FCRA_AUTHORIZATION_MISSING");
  });

  it("blocks non-admins from the adverse-action endpoints", async () => {
    process.env.WASHMATE_ADMIN_USER_IDS = "another_operator";
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    for (const path of [
      "/api/admin/washer-screening/:userId/pre-adverse",
      "/api/admin/washer-screening/:userId/adverse-final",
      "/api/admin/washer-screening/:userId/clear-dispute",
    ]) {
      const result = await invokeRoute(
        registered.get(path)!,
        {},
        { error: vi.fn(), warn: vi.fn() },
        { userId: "washer_target" },
      );
      expect(result.statusCode).toBe(403);
    }
    expect(mocks.storage.transitionAdverseAction).not.toHaveBeenCalled();
  });

  it("refuses to generate a pre-adverse notice while business details are unconfigured", async () => {
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/pre-adverse")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(409);
    expect(mocks.storage.transitionAdverseAction).not.toHaveBeenCalled();
  });

  it("generates the pre-adverse notice for an admin with configured details", async () => {
    process.env.FCRA_BUSINESS_NAME = "WashMate LLC";
    process.env.FCRA_BUSINESS_ADDRESS = "123 Main St, Kansas City, MO";
    process.env.FCRA_BUSINESS_PHONE = "555-1234";
    mocks.storage.transitionAdverseAction.mockResolvedValue({
      userId: "washer_target",
      bgCheckStatus: "pre_adverse_action",
      legalName: "Test Washer",
      preAdverseSentAt: new Date("2026-10-16T00:00:00.000Z"),
    });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/pre-adverse")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result).bgCheckStatus).toBe("pre_adverse_action");
    expect(bodyOf(result).notice).toContain("TEMPLATE");
    expect(bodyOf(result).notice).toContain("WashMate LLC");
    expect(bodyOf(result).deliveryNote).toBeDefined();
    expect(mocks.storage.transitionAdverseAction).toHaveBeenCalledWith(
      "washer_target",
      expect.objectContaining({ toStatus: "pre_adverse_action", actorId: "washer_1" }),
    );
  });

  it("maps an unelapsed waiting period to 409 on adverse-final", async () => {
    process.env.FCRA_BUSINESS_NAME = "WashMate LLC";
    process.env.FCRA_BUSINESS_ADDRESS = "123 Main St, Kansas City, MO";
    process.env.FCRA_BUSINESS_PHONE = "555-1234";
    const err = new Error("ADVERSE_ACTION_WAIT_NOT_ELAPSED") as Error & { remainingBusinessDays?: number };
    err.remainingBusinessDays = 3;
    mocks.storage.transitionAdverseAction.mockRejectedValue(err);
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/adverse-final")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(409);
    expect(bodyOf(result).remainingBusinessDays).toBe(3);
  });

  it("lets an admin clear a flagged washer on dispute resolution", async () => {
    mocks.storage.transitionAdverseAction.mockResolvedValue({
      userId: "washer_target",
      bgCheckStatus: "cleared",
    });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/admin/washer-screening/:userId/clear-dispute")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
      { userId: "washer_target" },
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result).bgCheckStatus).toBe("cleared");
    expect(mocks.storage.transitionAdverseAction).toHaveBeenCalledWith(
      "washer_target",
      expect.objectContaining({ toStatus: "cleared", reasonCode: "dispute_resolved" }),
    );
  });

  it("extends the washer status view with authorization and adverse-action state", async () => {
    mocks.storage.getWasherBgCheckStatus.mockResolvedValue({ bgCheckStatus: "pre_adverse_action" });
    mocks.storage.getWasherProfile.mockResolvedValue({
      userId: "washer_1",
      fcraDisclosureVersion: "1.0",
      fcraAuthorizedAt: new Date(),
    });
    mocks.storage.getAdverseActionInfo.mockResolvedValue({
      bgCheckStatus: "pre_adverse_action",
      preAdverseSentAt: new Date("2026-10-16T00:00:00.000Z"),
      waitDays: 5,
      readiness: { allowed: false, businessDaysElapsed: 0, waitDays: 5, remainingBusinessDays: 5 },
    });
    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer-profile/status")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(200);
    expect(bodyOf(result).bgCheckStatus).toBe("pre_adverse_action");
    expect(bodyOf(result).fcraAuthorized).toBe(true);
    expect(bodyOf(result).fcraDisclosureCurrent).toBe("1.0");
    expect(bodyOf(result).adverseAction.status).toBe("pre_adverse_action");
    expect(bodyOf(result).adverseAction.remainingBusinessDays).toBe(5);
  });
});

describe("washer financial connections error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage.getUser.mockResolvedValue({ id: "washer_1", role: "washer" });
    mocks.storage.getWasherProfile.mockResolvedValue({
      userId: "washer_1",
      stripeCustomerId: "cus_washer_1",
    });
  });

  it("keeps provider details out of session creation errors while logging them", async () => {
    const providerError = new Error("Stripe secret provider detail");
    mocks.storage.getWasherProfile.mockResolvedValue({
      userId: "washer_1",
      stripeCustomerId: null,
    });
    mocks.getUncachableStripeClient.mockRejectedValue(providerError);

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const log = { error: vi.fn(), warn: vi.fn() };
    const result = await invokeRoute(
      registered.get("/api/washer-profile/financial-connections/session")!,
      {},
      log,
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toEqual({
      message: "Something went wrong starting Stripe verification — please try again",
    });
    expect(JSON.stringify(result.body)).not.toContain(providerError.message);
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      { err: providerError },
      "Failed to create Financial Connections session",
    );
  });

  it("keeps provider details out of session completion errors while logging them", async () => {
    const providerError = new Error("Stripe account retrieval detail");
    mocks.getUncachableStripeClient.mockRejectedValue(providerError);

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const log = { error: vi.fn(), warn: vi.fn() };
    const result = await invokeRoute(
      registered.get("/api/washer-profile/financial-connections/complete")!,
      { sessionId: "fcs_test_session" },
      log,
    );

    expect(result.statusCode).toBe(500);
    expect(result.body).toEqual({
      message: "Something went wrong verifying your bank account — please try again",
    });
    expect(JSON.stringify(result.body)).not.toContain(providerError.message);
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      { err: providerError },
      "Failed to complete Financial Connections session",
    );
  });

  it("keeps incomplete bank verification retryable without persisting an empty account", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      id: "fcs_incomplete",
      account_holder: {
        type: "customer",
        customer: "cus_washer_1",
      },
      accounts: {
        data: [],
      },
      status: "provider-only incomplete detail",
    });
    mocks.getUncachableStripeClient.mockResolvedValue({
      financialConnections: {
        sessions: { retrieve },
      },
    });

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const log = { error: vi.fn(), warn: vi.fn() };
    const result = await invokeRoute(
      registered.get("/api/washer-profile/financial-connections/complete")!,
      { sessionId: "fcs_incomplete" },
      log,
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({
      message: "No bank account was linked. Please try again.",
    });
    expect(JSON.stringify(result.body)).not.toContain("fcs_incomplete");
    expect(JSON.stringify(result.body)).not.toContain("provider-only incomplete detail");
    expect(retrieve).toHaveBeenCalledExactlyOnceWith("fcs_incomplete", {
      expand: ["accounts"],
    });
    expect(mocks.storage.attachStripeBankAccount).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });

  it("rejects a Financial Connections session owned by another customer without persisting it", async () => {
    const retrieve = vi.fn().mockResolvedValue({
      account_holder: {
        type: "customer",
        customer: "cus_another_washer",
      },
      accounts: {
        data: [{
          id: "fca_another_washer",
          institution_name: "Provider-only bank detail",
          last4: "9876",
        }],
      },
    });
    mocks.getUncachableStripeClient.mockResolvedValue({
      financialConnections: {
        sessions: { retrieve },
      },
    });

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const log = { error: vi.fn(), warn: vi.fn() };
    const result = await invokeRoute(
      registered.get("/api/washer-profile/financial-connections/complete")!,
      { sessionId: "fcs_another_washer" },
      log,
    );

    expect(result.statusCode).toBe(403);
    expect(result.body).toEqual({
      message: "Verification session does not belong to your account",
    });
    expect(JSON.stringify(result.body)).not.toContain("cus_another_washer");
    expect(JSON.stringify(result.body)).not.toContain("fca_another_washer");
    expect(JSON.stringify(result.body)).not.toContain("Provider-only bank detail");
    expect(retrieve).toHaveBeenCalledExactlyOnceWith("fcs_another_washer", {
      expand: ["accounts"],
    });
    expect(mocks.storage.attachStripeBankAccount).not.toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
  });
});

describe("washer payout error handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage.getUser.mockResolvedValue({ id: "washer_1", role: "washer" });
    mocks.storage.requestPayout.mockResolvedValue({
      id: 42,
      amountCents: 2500,
      orderCount: 1,
      status: "pending",
    });
  });

  it("preserves the bank verification guidance when no bank is verified", async () => {
    mocks.storage.requestPayout.mockRejectedValue(new Error("NO_VERIFIED_BANK"));

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer-profile/payouts")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({
      message: "Verify a bank account before requesting a payout.",
    });
    expect(mocks.executePayout).not.toHaveBeenCalled();
  });

  it("preserves the unpaid earnings guidance when there is nothing to pay out", async () => {
    mocks.storage.requestPayout.mockRejectedValue(new Error("NO_UNPAID_EARNINGS"));

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer-profile/payouts")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toEqual({
      message: "You have no unpaid earnings to pay out right now.",
    });
    expect(mocks.executePayout).not.toHaveBeenCalled();
  });

  it("preserves the missing profile response when the washer profile is unavailable", async () => {
    mocks.storage.requestPayout.mockRejectedValue(new Error("WASHER_PROFILE_NOT_FOUND"));

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer-profile/payouts")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({
      message: "Washer profile not found",
    });
    expect(mocks.executePayout).not.toHaveBeenCalled();
  });

  it("returns a generic 502 while logging provider details", async () => {
    const providerError = new Error("Stripe account capability detail");
    mocks.executePayout.mockRejectedValue(providerError);

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const log = { error: vi.fn(), warn: vi.fn() };
    const result = await invokeRoute(
      registered.get("/api/washer-profile/payouts")!,
      {},
      log,
    );

    expect(result.statusCode).toBe(502);
    expect(result.body).toEqual({
      message: "Payout could not be sent to your bank. Please try again.",
    });
    expect(JSON.stringify(result.body)).not.toContain(providerError.message);
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      { err: providerError, payoutId: 42 },
      "executePayout failed",
    );
  });
});

describe("washer payout history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.storage.getUser.mockResolvedValue({ id: "washer_1", role: "washer" });
    mocks.storage.getWasherProfile.mockResolvedValue({
      stripeBankAccountId: "ba_verified",
      verifiedBankName: "Example Bank",
      verifiedAccountLast4: "1234",
    });
  });

  it("redacts provider details from stored payout failure reasons", async () => {
    const providerFailure = "Stripe account capability detail";
    mocks.storage.getWasherEarnings.mockResolvedValue({
      unpaidEarningsCents: 0,
      unpaidPlatformFeeCents: 0,
      unpaidOrderCount: 0,
      payouts: [
        {
          id: 42,
          amountCents: 2500,
          platformFeeCents: 500,
          totalFeeCents: 3000,
          orderCount: 1,
          status: "failed",
          verifiedBankName: "Example Bank",
          verifiedAccountLast4: "1234",
          failureReason: providerFailure,
          createdAt: new Date("2026-09-23T00:00:00.000Z"),
          paidAt: null,
        },
      ],
    });

    const { app, registered } = createRouteApp();
    await registerRoutes({} as any, app);

    const result = await invokeRoute(
      registered.get("/api/washer-profile/earnings")!,
      {},
      { error: vi.fn(), warn: vi.fn() },
    );

    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({
      payouts: [
        {
          id: 42,
          status: "failed",
          failureReason: "Payout could not be sent to your bank. Please try again.",
        },
      ],
    });
    expect(JSON.stringify(result.body)).not.toContain(providerFailure);
  });
});
