import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getWasherProfile: vi.fn(),
    setCheckrScreeningRequest: vi.fn(),
    transitionWasherBgCheck: vi.fn(),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("./logger", () => ({ logger: mocks.logger }));

import {
  CHECKR_API_BASE,
  CheckrApiError,
  createCheckrCandidate,
  createCheckrInvitation,
  getCheckrConfig,
  getCheckrInvitation,
  startWasherScreening,
  verifyCheckrSignature,
  type CheckrConfig,
} from "./checkr";
import { FCRA_DISCLOSURE_VERSION } from "./fcra";

/** A mocked profile with a valid FCRA written authorization. */
function authorizedProfile(overrides: Record<string, unknown> = {}) {
  return {
    fcraAuthorizedAt: new Date(),
    fcraDisclosureVersion: FCRA_DISCLOSURE_VERSION,
    ...overrides,
  };
}

const TEST_CONFIG: CheckrConfig = {
  apiKey: "test_api_key",
  packageSlug: "test_package",
  webhookSecrets: ["whsec_test", "test_api_key"],
};

function sign(body: Buffer, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Route fetch calls by "METHOD url" to canned responses. */
function mockFetch(routes: Record<string, { status: number; body: unknown }>) {
  return vi.fn(async (url: string, init?: { method?: string; headers?: any; body?: string }) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch: ${key}`);
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      text: async () => JSON.stringify(route.body),
    };
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("verifyCheckrSignature", () => {
  const body = Buffer.from(JSON.stringify({ id: "evt_1", type: "report.completed" }));

  it("accepts a valid sha256= prefixed signature", () => {
    expect(verifyCheckrSignature(body, sign(body, "whsec_test"), ["whsec_test"])).toBe(true);
  });

  it("accepts a bare hex digest", () => {
    const bare = sign(body, "whsec_test").replace("sha256=", "");
    expect(verifyCheckrSignature(body, bare, ["whsec_test"])).toBe(true);
  });

  it("rejects a tampered body", () => {
    const tampered = Buffer.from(JSON.stringify({ id: "evt_1", type: "report.completed", evil: true }));
    expect(verifyCheckrSignature(tampered, sign(body, "whsec_test"), ["whsec_test"])).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyCheckrSignature(body, sign(body, "wrong"), ["whsec_test"])).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(verifyCheckrSignature(body, undefined, ["whsec_test"])).toBe(false);
  });

  it("rejects when no secrets are configured", () => {
    expect(verifyCheckrSignature(body, sign(body, "whsec_test"), [])).toBe(false);
  });

  it("tries each secret so rotation never drops events", () => {
    expect(verifyCheckrSignature(body, sign(body, "new_secret"), ["old_secret", "new_secret"])).toBe(true);
  });

  it("rejects non-hex digests", () => {
    expect(verifyCheckrSignature(body, "not-hex-at-all!!!", ["whsec_test"])).toBe(false);
  });
});

describe("getCheckrConfig", () => {
  it("returns null without an API key", () => {
    expect(getCheckrConfig({})).toBeNull();
  });

  it("prefers CHECKR_WEBHOOK_SECRET and falls back to the API key", () => {
    const config = getCheckrConfig({ CHECKR_API_KEY: "key", CHECKR_WEBHOOK_SECRET: "whsec" });
    expect(config?.webhookSecrets).toEqual(["whsec", "key"]);
    const fallback = getCheckrConfig({ CHECKR_API_KEY: "key" });
    expect(fallback?.webhookSecrets).toEqual(["key"]);
  });
});

describe("Checkr API client", () => {
  beforeEach(() => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile());
    mocks.storage.setCheckrScreeningRequest.mockResolvedValue(undefined);
  });

  it("creates a candidate with minimal PII (email + custom_id only)", async () => {
    const fetchMock = mockFetch({
      [`POST ${CHECKR_API_BASE}/candidates`]: { status: 201, body: { id: "cand_1", object: "candidate" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckrCandidate(TEST_CONFIG, { email: "w@example.com", customId: "user_1" });
    expect(result).toEqual({ id: "cand_1" });
    const init = fetchMock.mock.calls[0]?.[1] as { headers: any; body: string };
    expect(init.headers.Authorization).toBe(
      "Basic " + Buffer.from("test_api_key:").toString("base64"),
    );
    const sent = JSON.parse(init.body);
    expect(Object.keys(sent).sort()).toEqual(["custom_id", "email"]);
  });

  it("creates an invitation with package and US work location", async () => {
    const fetchMock = mockFetch({
      [`POST ${CHECKR_API_BASE}/invitations`]: { status: 201, body: { id: "inv_1", status: "pending" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createCheckrInvitation(TEST_CONFIG, { candidateId: "cand_1", state: "ks" });
    expect(result).toEqual({ id: "inv_1" });
    const sent = JSON.parse((fetchMock.mock.calls[0]?.[1] as { body: string }).body);
    expect(sent).toEqual({
      candidate_id: "cand_1",
      package: "test_package",
      work_locations: [{ country: "US", state: "KS" }],
    });
  });

  it("refuses to create an invitation without a package slug", async () => {
    const noPackage = { ...TEST_CONFIG, packageSlug: "" };
    await expect(createCheckrInvitation(noPackage, { candidateId: "cand_1", state: "KS" })).rejects.toThrow(
      "CHECKR_NOT_CONFIGURED",
    );
  });

  it("throws CheckrApiError with status on API failure", async () => {
    const fetchMock = mockFetch({
      [`POST ${CHECKR_API_BASE}/candidates`]: { status: 401, body: { error: "unauthorized" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await createCheckrCandidate(TEST_CONFIG, { email: "w@example.com", customId: "u" }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(CheckrApiError);
    expect(err.status).toBe(401);
  });
});

describe("startWasherScreening idempotency", () => {
  const input = { userId: "user_1", email: "w@example.com", state: "KS" };

  beforeEach(() => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile());
    mocks.storage.setCheckrScreeningRequest.mockResolvedValue(undefined);
  });

  function candidateAndInvitationRoutes(invitationStatus?: string) {
    return {
      [`POST ${CHECKR_API_BASE}/candidates`]: { status: 201, body: { id: "cand_1" } },
      [`POST ${CHECKR_API_BASE}/invitations`]: { status: 201, body: { id: "inv_new" } },
      ...(invitationStatus
        ? {
            [`GET ${CHECKR_API_BASE}/invitations/inv_old`]: {
              status: 200,
              body: { id: "inv_old", status: invitationStatus },
            },
          }
        : {}),
    };
  }

  it("creates a candidate and invitation for a first-time screening", async () => {
    vi.stubGlobal("fetch", mockFetch(candidateAndInvitationRoutes()));
    const result = await startWasherScreening(input, { config: TEST_CONFIG });
    expect(result).toEqual({ candidateId: "cand_1", invitationId: "inv_new", invitationReused: false });
    expect(mocks.storage.setCheckrScreeningRequest).toHaveBeenCalledWith("user_1", {
      candidateId: "cand_1",
      invitationId: "inv_new",
    });
  });

  it("reuses the existing candidate instead of creating a duplicate", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile({ checkrCandidateId: "cand_existing", checkrInvitationId: null }));
    const fetchMock = mockFetch(candidateAndInvitationRoutes());
    vi.stubGlobal("fetch", fetchMock);
    const result = await startWasherScreening(input, { config: TEST_CONFIG });
    expect(result.candidateId).toBe("cand_existing");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/candidates"))).toBe(false);
  });

  it("reuses a still-pending invitation", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile({
      checkrCandidateId: "cand_1",
      checkrInvitationId: "inv_old",
    }));
    const fetchMock = mockFetch(candidateAndInvitationRoutes("pending"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await startWasherScreening(input, { config: TEST_CONFIG });
    expect(result).toEqual({ candidateId: "cand_1", invitationId: "inv_old", invitationReused: true });
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/invitations") && init?.method === "POST")).toBe(false);
  });

  it("orders a fresh invitation when the stored one expired", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile({
      checkrCandidateId: "cand_1",
      checkrInvitationId: "inv_old",
    }));
    const fetchMock = mockFetch(candidateAndInvitationRoutes("expired"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await startWasherScreening(input, { config: TEST_CONFIG });
    expect(result.invitationId).toBe("inv_new");
    expect(result.invitationReused).toBe(false);
  });

  it("orders a fresh invitation when the stored one vanished (404)", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(authorizedProfile({
      checkrCandidateId: "cand_1",
      checkrInvitationId: "inv_old",
    }));
    const fetchMock = mockFetch({
      ...candidateAndInvitationRoutes(),
      [`GET ${CHECKR_API_BASE}/invitations/inv_old`]: { status: 404, body: { error: "not found" } },
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await startWasherScreening(input, { config: TEST_CONFIG });
    expect(result.invitationId).toBe("inv_new");
  });

  it("throws CHECKR_NOT_CONFIGURED without an API key", async () => {
    await expect(startWasherScreening(input, { config: null })).rejects.toThrow("CHECKR_NOT_CONFIGURED");
  });

  it("rejects a malformed state code", async () => {
    await expect(
      startWasherScreening({ ...input, state: "Kansas" }, { config: TEST_CONFIG }),
    ).rejects.toThrow("CHECKR_INVALID_STATE");
  });

  it("never transitions screening status (a washer cannot self-decide via this path)", async () => {
    vi.stubGlobal("fetch", mockFetch(candidateAndInvitationRoutes()));
    await startWasherScreening(input, { config: TEST_CONFIG });
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });
});

describe("startWasherScreening FCRA gate", () => {
  const input = { userId: "user_1", email: "w@example.com", state: "KS" };

  beforeEach(() => {
    mocks.storage.setCheckrScreeningRequest.mockResolvedValue(undefined);
  });

  it("refuses to create a candidate or invitation without FCRA authorization", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(startWasherScreening(input, { config: TEST_CONFIG })).rejects.toThrow(
      "FCRA_AUTHORIZATION_MISSING",
    );
    // Fail-closed: the provider is never contacted.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.storage.setCheckrScreeningRequest).not.toHaveBeenCalled();
  });

  it("refuses when the authorization is under a stale disclosure version", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(
      authorizedProfile({ fcraDisclosureVersion: "0.0" }),
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(startWasherScreening(input, { config: TEST_CONFIG })).rejects.toThrow(
      "FCRA_AUTHORIZATION_MISSING",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses when the authorization timestamp is missing", async () => {
    mocks.storage.getWasherProfile.mockResolvedValue(
      authorizedProfile({ fcraAuthorizedAt: null }),
    );
    await expect(startWasherScreening(input, { config: TEST_CONFIG })).rejects.toThrow(
      "FCRA_AUTHORIZATION_MISSING",
    );
  });
});
