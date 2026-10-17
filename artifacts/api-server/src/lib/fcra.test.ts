import { describe, expect, it, vi, afterEach } from "vitest";
import {
  ADVERSE_ACTION_TRANSITIONS,
  ADVERSE_ACTION_WAIT_DAYS_DEFAULT,
  FCRA_DISCLOSURE_VERSION,
  FCRA_NOTICE_VERSION,
  addBusinessDays,
  assertFcraAuthorization,
  businessDaysElapsed,
  canCompleteAdverseAction,
  getAdverseActionWaitDays,
  getAllowedAdverseTransitions,
  getFcraBusinessDetails,
  isFcraAuthorized,
} from "./fcra";
import { renderFcraDisclosureText } from "./fcraDisclosure";
import {
  CFPB_RIGHTS_URL,
  renderAdverseActionNotice,
  renderPreAdverseNotice,
} from "./fcraNotices";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("businessDaysElapsed", () => {
  it("counts weekdays between Monday and Friday", () => {
    // 2026-10-12 is a Monday, 2026-10-16 a Friday.
    expect(businessDaysElapsed(new Date("2026-10-12T09:00:00"), new Date("2026-10-16T17:00:00"))).toBe(4);
  });

  it("skips weekends", () => {
    // Friday -> Monday counts only Monday.
    expect(businessDaysElapsed(new Date("2026-10-16T09:00:00"), new Date("2026-10-19T09:00:00"))).toBe(1);
    // Friday -> the following Friday counts 5.
    expect(businessDaysElapsed(new Date("2026-10-16T09:00:00"), new Date("2026-10-23T09:00:00"))).toBe(5);
  });

  it("returns 0 for the same day and when inverted", () => {
    const d = new Date("2026-10-14T12:00:00");
    expect(businessDaysElapsed(d, d)).toBe(0);
    expect(businessDaysElapsed(new Date("2026-10-16T09:00:00"), new Date("2026-10-12T09:00:00"))).toBe(0);
  });
});

describe("addBusinessDays", () => {
  it("rolls Friday + 1 business day to Monday", () => {
    expect(addBusinessDays(new Date("2026-10-16T12:00:00"), 1).getDay()).toBe(1);
  });

  it("adds 5 business days across a weekend", () => {
    const result = addBusinessDays(new Date("2026-10-12T12:00:00"), 5);
    expect(result.getDay()).toBe(1); // lands on Monday
    expect(result.getDate()).toBe(19);
  });
});

describe("isFcraAuthorized / assertFcraAuthorization", () => {
  const valid = {
    fcraAuthorizedAt: new Date(),
    fcraDisclosureVersion: FCRA_DISCLOSURE_VERSION,
  };

  it("accepts a current, timestamped authorization", () => {
    expect(isFcraAuthorized(valid)).toBe(true);
    expect(() => assertFcraAuthorization(valid)).not.toThrow();
  });

  it("rejects a stale disclosure version (re-authorization required)", () => {
    expect(isFcraAuthorized({ ...valid, fcraDisclosureVersion: "0.9" })).toBe(false);
    expect(() => assertFcraAuthorization({ ...valid, fcraDisclosureVersion: "0.9" })).toThrow(
      "FCRA_AUTHORIZATION_MISSING",
    );
  });

  it("rejects a missing timestamp", () => {
    expect(isFcraAuthorized({ ...valid, fcraAuthorizedAt: null })).toBe(false);
  });

  it("rejects a missing profile or missing version", () => {
    expect(isFcraAuthorized(undefined)).toBe(false);
    expect(isFcraAuthorized(null)).toBe(false);
    expect(isFcraAuthorized({ ...valid, fcraDisclosureVersion: null })).toBe(false);
    expect(() => assertFcraAuthorization(undefined)).toThrow("FCRA_AUTHORIZATION_MISSING");
  });
});

describe("adverse-action transition map", () => {
  it("allows flagged -> pre_adverse_action or cleared (dispute)", () => {
    expect(getAllowedAdverseTransitions("flagged")).toEqual(["pre_adverse_action", "cleared"]);
  });

  it("allows pre_adverse_action -> adverse_action_final or cleared", () => {
    expect(getAllowedAdverseTransitions("pre_adverse_action")).toEqual(["adverse_action_final", "cleared"]);
  });

  it("never regresses terminal states", () => {
    for (const terminal of ["cleared", "adverse_action_final", "not_started", "pending", "provider_failed"] as const) {
      expect(getAllowedAdverseTransitions(terminal)).toEqual([]);
    }
  });

  it("exposes the pure map for audit/review", () => {
    expect(ADVERSE_ACTION_TRANSITIONS.flagged).toContain("pre_adverse_action");
  });
});

describe("canCompleteAdverseAction", () => {
  it("blocks completion before the waiting period elapses", () => {
    // Pre-adverse sent Monday 2026-10-12; checking Friday — only 4 business days.
    const readiness = canCompleteAdverseAction(new Date("2026-10-12T09:00:00"), 5, new Date("2026-10-16T17:00:00"));
    expect(readiness.allowed).toBe(false);
    expect(readiness.businessDaysElapsed).toBe(4);
    expect(readiness.remainingBusinessDays).toBe(1);
  });

  it("allows completion once the waiting period has elapsed", () => {
    // Monday + 5 business days = next Monday.
    const readiness = canCompleteAdverseAction(new Date("2026-10-12T09:00:00"), 5, new Date("2026-10-19T09:00:00"));
    expect(readiness.allowed).toBe(true);
    expect(readiness.remainingBusinessDays).toBe(0);
  });

  it("blocks when no pre-adverse notice was sent", () => {
    const readiness = canCompleteAdverseAction(null, 5, new Date("2026-10-19T09:00:00"));
    expect(readiness.allowed).toBe(false);
    expect(readiness.remainingBusinessDays).toBe(5);
  });

  it("honors a custom waiting period", () => {
    const sent = new Date("2026-10-12T09:00:00");
    const friday = new Date("2026-10-16T17:00:00");
    expect(canCompleteAdverseAction(sent, 3, friday).allowed).toBe(true);
    expect(canCompleteAdverseAction(sent, 5, friday).allowed).toBe(false);
  });
});

describe("getAdverseActionWaitDays", () => {
  it("defaults to 5 business days", () => {
    expect(getAdverseActionWaitDays({})).toBe(5);
    expect(ADVERSE_ACTION_WAIT_DAYS_DEFAULT).toBe(5);
  });

  it("reads the env override", () => {
    expect(getAdverseActionWaitDays({ ADVERSE_ACTION_WAIT_DAYS: "7" })).toBe(7);
  });

  it("falls back to default on invalid values", () => {
    expect(getAdverseActionWaitDays({ ADVERSE_ACTION_WAIT_DAYS: "0" })).toBe(5);
    expect(getAdverseActionWaitDays({ ADVERSE_ACTION_WAIT_DAYS: "-3" })).toBe(5);
    expect(getAdverseActionWaitDays({ ADVERSE_ACTION_WAIT_DAYS: "abc" })).toBe(5);
  });
});

describe("getFcraBusinessDetails", () => {
  it("reports unconfigured while placeholders remain", () => {
    const details = getFcraBusinessDetails({});
    expect(details.isConfigured).toBe(false);
    expect(details.businessName).toContain("[");
  });

  it("reports configured with real details", () => {
    const details = getFcraBusinessDetails({
      FCRA_BUSINESS_NAME: "WashMate LLC",
      FCRA_BUSINESS_ADDRESS: "123 Main St, Kansas City, MO",
      FCRA_BUSINESS_PHONE: "555-1234",
    });
    expect(details.isConfigured).toBe(true);
    expect(details.businessName).toBe("WashMate LLC");
    expect(details.craName).toBe("Checkr, Inc.");
  });
});

describe("FCRA disclosure text", () => {
  it("is versioned and names the CRA", () => {
    expect(FCRA_DISCLOSURE_VERSION).toBe("1.0");
    const text = renderFcraDisclosureText({
      businessName: "WashMate LLC",
      businessAddress: "123 Main St",
      businessPhone: "555-1234",
      craName: "Checkr, Inc.",
    });
    expect(text).toContain("Checkr, Inc.");
    expect(text).toContain("WashMate LLC");
    expect(text).toContain("Version 1.0");
  });

  it("is genuinely standalone — no bundled waivers or terms", () => {
    const text = renderFcraDisclosureText({
      businessName: "WashMate LLC",
      businessAddress: "123 Main St",
      businessPhone: "555-1234",
      craName: "Checkr, Inc.",
    }).toLowerCase();
    expect(text).not.toContain("terms of service");
    expect(text).not.toContain("waiver");
    expect(text).not.toContain("release of liability");
    expect(text).not.toContain("arbitration");
  });

  it("carries the counsel-review marker when placeholders remain", () => {
    const text = renderFcraDisclosureText({
      businessName: "[BUSINESS NAME]",
      businessAddress: "[BUSINESS ADDRESS]",
      businessPhone: "[BUSINESS PHONE]",
      craName: "Checkr, Inc.",
    });
    expect(text).toContain("employment counsel");
  });
});

describe("adverse-action notice templates", () => {
  const base = {
    businessName: "WashMate LLC",
    businessAddress: "123 Main St, Kansas City, MO",
    businessPhone: "555-1234",
    craName: "Checkr, Inc.",
    craAddress: "1 Montgomery St, San Francisco, CA",
    craPhone: "844-824-3257",
    candidateName: "Test Washer",
    noticeDate: "October 16, 2026",
  };

  it("pre-adverse notice is a counsel-review template referencing the report copy and CFPB rights", () => {
    expect(FCRA_NOTICE_VERSION).toBe("1.0");
    const notice = renderPreAdverseNotice({ ...base, responseDeadline: "October 23, 2026" });
    expect(notice).toContain("TEMPLATE");
    expect(notice).toContain("employment counsel");
    expect(notice).toContain("COPY OF THE CONSUMER REPORT");
    expect(notice).toContain(CFPB_RIGHTS_URL);
    expect(notice).toContain("October 23, 2026");
  });

  it("final notice includes CRA contact info and the CRA-did-not-decide statement", () => {
    const notice = renderAdverseActionNotice(base);
    expect(notice).toContain("Checkr, Inc.");
    expect(notice).toContain("844-824-3257");
    expect(notice).toContain("did NOT make this decision");
    expect(notice).toContain("60 days");
  });

  it("does not reproduce the CFPB Summary of Rights document", () => {
    const notice = renderPreAdverseNotice({ ...base, responseDeadline: "October 23, 2026" });
    // It links to the document instead of reproducing it.
    expect(notice).toContain(CFPB_RIGHTS_URL);
    expect(notice.length).toBeLessThan(4000);
  });
});
