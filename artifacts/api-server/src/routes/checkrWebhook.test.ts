import type { Express } from "express";
import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: {
    getWasherProfileByCheckrCandidateId: vi.fn(),
    transitionWasherBgCheck: vi.fn(),
    clearCheckrInvitation: vi.fn(),
  },
}));

vi.mock("../storage", () => ({ storage: mocks.storage }));
vi.mock("../lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { mountCheckrWebhook } from "./checkrWebhook";
import { insertWasherProfileSchema } from "@workspace/db";

const WEBHOOK_SECRET = "whsec_test_checkr";
const OLD_ENV = { ...process.env };

function handler() {
  let routeHandlers: any[] = [];
  const app = {
    post: (_path: string, ...handlers: any[]) => {
      routeHandlers = handlers;
    },
  } as unknown as Express;
  mountCheckrWebhook(app);
  return routeHandlers.at(-1);
}

async function deliver(event: unknown, opts?: { secret?: string; omitSignature?: boolean; raw?: string }) {
  const raw = opts?.raw ?? JSON.stringify(event);
  const body = Buffer.from(raw);
  const headers: Record<string, string> = {};
  const get = (name: string) => {
    if (name.toLowerCase() === "x-checkr-signature" && !opts?.omitSignature) {
      return "sha256=" + crypto.createHmac("sha256", opts?.secret ?? WEBHOOK_SECRET).update(body).digest("hex");
    }
    return undefined;
  };
  const result: { status: number; body?: any } = { status: 0 };
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(payload: any) {
      result.body = payload;
      return this;
    },
  };
  await handler()({ body, headers, get }, res);
  return result;
}

function reportEvent(reportId: string, candidateId: string, status: string) {
  return {
    id: `evt_${reportId}`,
    object: "event",
    type: "report.completed",
    data: { object: { id: reportId, object: "report", candidate_id: candidateId, status } },
  };
}

function pendingProfile(overrides: Record<string, unknown> = {}) {
  return {
    userId: "washer_1",
    bgCheckStatus: "pending",
    checkrCandidateId: "cand_1",
    checkrInvitationId: "inv_1",
    checkrReportId: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CHECKR_API_KEY = "test_api_key";
  process.env.CHECKR_WEBHOOK_SECRET = WEBHOOK_SECRET;
  process.env.CHECKR_PACKAGE = "test_package";
  mocks.storage.getWasherProfileByCheckrCandidateId.mockResolvedValue(pendingProfile());
  mocks.storage.transitionWasherBgCheck.mockImplementation(async (_userId: string, input: any) => ({
    userId: "washer_1",
    bgCheckStatus: input.toStatus,
  }));
  mocks.storage.clearCheckrInvitation.mockResolvedValue(true);
});

afterEach(() => {
  process.env = { ...OLD_ENV };
});

describe("Checkr report webhook decisions", () => {
  it("transitions pending → cleared on a clear report", async () => {
    const result = await deliver(reportEvent("rep_1", "cand_1", "clear"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).toHaveBeenCalledWith("washer_1", {
      toStatus: "cleared",
      actorType: "provider",
      actorId: "checkr",
      providerReference: "rep_1",
      reasonCode: "provider_cleared",
      decision: { result: "clear", reportId: "rep_1" },
    });
  });

  it("transitions pending → flagged on a consider report", async () => {
    const result = await deliver(reportEvent("rep_2", "cand_1", "consider"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).toHaveBeenCalledWith(
      "washer_1",
      expect.objectContaining({ toStatus: "flagged", reasonCode: "provider_flagged" }),
    );
  });

  it("transitions pending → provider_failed on a suspended report", async () => {
    const result = await deliver(reportEvent("rep_3", "cand_1", "suspended"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).toHaveBeenCalledWith(
      "washer_1",
      expect.objectContaining({ toStatus: "provider_failed", reasonCode: "provider_failed" }),
    );
  });

  it("ignores a duplicate delivery of an already-processed report", async () => {
    mocks.storage.getWasherProfileByCheckrCandidateId.mockResolvedValue(
      pendingProfile({ checkrReportId: "rep_1", bgCheckStatus: "cleared" }),
    );
    const result = await deliver(reportEvent("rep_1", "cand_1", "clear"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("never regresses a decided screening on a stale event", async () => {
    mocks.storage.getWasherProfileByCheckrCandidateId.mockResolvedValue(
      pendingProfile({ bgCheckStatus: "cleared", checkrReportId: "rep_old" }),
    );
    const result = await deliver(reportEvent("rep_new", "cand_1", "consider"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("treats a lost transition race as already-handled", async () => {
    mocks.storage.transitionWasherBgCheck.mockRejectedValue(new Error("BG_CHECK_NOT_PENDING"));
    const result = await deliver(reportEvent("rep_4", "cand_1", "clear"));
    expect(result.status).toBe(200);
  });

  it("acknowledges events for unknown candidates without failing", async () => {
    mocks.storage.getWasherProfileByCheckrCandidateId.mockResolvedValue(undefined);
    const result = await deliver(reportEvent("rep_5", "cand_unknown", "clear"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("ignores non-decision event types", async () => {
    for (const type of ["invitation.completed", "report.created", "candidate.created", "report.upgraded"]) {
      const result = await deliver({ id: "evt_x", object: "event", type, data: { object: {} } });
      expect(result.status).toBe(200);
    }
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
    expect(mocks.storage.clearCheckrInvitation).not.toHaveBeenCalled();
  });

  it("ignores a report event with an unusable status", async () => {
    const result = await deliver(reportEvent("rep_6", "cand_1", "pending"));
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });
});

describe("Checkr invitation expiry", () => {
  it("clears a matching pending invitation so a fresh one can be issued", async () => {
    const result = await deliver({
      id: "evt_inv",
      object: "event",
      type: "invitation.expired",
      data: { object: { id: "inv_1", object: "invitation", candidate_id: "cand_1", status: "expired" } },
    });
    expect(result.status).toBe(200);
    expect(mocks.storage.clearCheckrInvitation).toHaveBeenCalledWith("washer_1", "inv_1");
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("does not touch decided screenings on invitation expiry", async () => {
    // clearCheckrInvitation itself only clears pending+matching rows; the
    // route must still not attempt a status transition here.
    mocks.storage.getWasherProfileByCheckrCandidateId.mockResolvedValue(
      pendingProfile({ bgCheckStatus: "flagged", checkrReportId: "rep_9" }),
    );
    const result = await deliver({
      id: "evt_inv2",
      object: "event",
      type: "invitation.expired",
      data: { object: { id: "inv_1", object: "invitation", candidate_id: "cand_1", status: "expired" } },
    });
    expect(result.status).toBe(200);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });
});

describe("Checkr webhook security", () => {
  it("rejects an invalid signature", async () => {
    const result = await deliver(reportEvent("rep_1", "cand_1", "clear"), { secret: "wrong" });
    expect(result.status).toBe(400);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", async () => {
    const result = await deliver(reportEvent("rep_1", "cand_1", "clear"), { omitSignature: true });
    expect(result.status).toBe(400);
    expect(mocks.storage.transitionWasherBgCheck).not.toHaveBeenCalled();
  });

  it("rejects all events when Checkr is not configured", async () => {
    delete process.env.CHECKR_API_KEY;
    const result = await deliver(reportEvent("rep_1", "cand_1", "clear"));
    expect(result.status).toBe(503);
  });

  it("rejects a malformed JSON body", async () => {
    const result = await deliver(null, { raw: "{not json" });
    expect(result.status).toBe(400);
  });
});

describe("washer screening authorization", () => {
  it("client input can never set bgCheckStatus (stripped by the insert schema)", () => {
    const parsed = insertWasherProfileSchema.parse({
      legalName: "Wash Er",
      dateOfBirth: "1990-01-02",
      phone: "5555555555",
      taxId: "1234",
      bgCheckStatus: "cleared",
    } as any);
    expect(parsed).not.toHaveProperty("bgCheckStatus");
  });

  it("client input can never set Checkr workflow identifiers", () => {
    const parsed = insertWasherProfileSchema.parse({
      legalName: "Wash Er",
      dateOfBirth: "1990-01-02",
      phone: "5555555555",
      taxId: "1234",
      checkrCandidateId: "cand_evil",
      checkrReportId: "rep_evil",
      bgCheckResult: "clear",
    } as any);
    expect(parsed).not.toHaveProperty("checkrCandidateId");
    expect(parsed).not.toHaveProperty("checkrReportId");
    expect(parsed).not.toHaveProperty("bgCheckResult");
  });
});
