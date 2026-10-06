import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { IncomingHttpHeaders } from "http";
import {
  buildAllowedHosts,
  getClerkProxyHost,
  normalizeHost,
} from "./clerkProxyMiddleware";

function makeReq(headers: IncomingHttpHeaders) {
  return { headers };
}

describe("normalizeHost", () => {
  it("returns undefined for falsy/empty input", () => {
    expect(normalizeHost(undefined)).toBeUndefined();
    expect(normalizeHost("")).toBeUndefined();
    expect(normalizeHost("   ")).toBeUndefined();
  });

  it("lowercases the host", () => {
    expect(normalizeHost("Example.COM")).toBe("example.com");
  });

  it("strips the default https port", () => {
    expect(normalizeHost("example.com:443")).toBe("example.com");
  });

  it("preserves non-default ports", () => {
    expect(normalizeHost("example.com:8080")).toBe("example.com:8080");
  });

  it("trims surrounding whitespace before normalization", () => {
    expect(normalizeHost("  Example.com:443  ")).toBe("example.com");
  });
});

describe("buildAllowedHosts", () => {
  it("returns an empty set when REPLIT_DOMAINS is empty", () => {
    expect(buildAllowedHosts("").size).toBe(0);
  });

  it("parses a single domain", () => {
    const hosts = buildAllowedHosts("app.example.com");
    expect(hosts.has("app.example.com")).toBe(true);
    expect(hosts.size).toBe(1);
  });

  it("parses comma-separated domains and trims whitespace", () => {
    const hosts = buildAllowedHosts("a.example.com, b.example.com ,c.example.com");
    expect(hosts.has("a.example.com")).toBe(true);
    expect(hosts.has("b.example.com")).toBe(true);
    expect(hosts.has("c.example.com")).toBe(true);
    expect(hosts.size).toBe(3);
  });

  it("ignores empty entries from trailing commas", () => {
    const hosts = buildAllowedHosts("a.example.com,,");
    expect(hosts.size).toBe(1);
  });
});

describe("getClerkProxyHost (production)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  const allowed = buildAllowedHosts("real.example.com,alt.example.com");

  it("rejects a forged x-forwarded-host that is not in the allowlist (falls back to validated Host)", () => {
    const req = makeReq({
      "x-forwarded-host": "evil.example",
      host: "real.example.com",
    });
    // Should NOT return evil.example. Host is allowlisted so it's used.
    expect(getClerkProxyHost(req, allowed)).toBe("real.example.com");
  });

  it("returns undefined (fail-closed) when both forwarded and Host headers are forged", () => {
    const req = makeReq({
      "x-forwarded-host": "evil.example",
      host: "also-evil.example",
    });
    expect(getClerkProxyHost(req, allowed)).toBeUndefined();
  });

  it("accepts an x-forwarded-host that is in the allowlist", () => {
    const req = makeReq({
      "x-forwarded-host": "alt.example.com",
      host: "real.example.com",
    });
    expect(getClerkProxyHost(req, allowed)).toBe("alt.example.com");
  });

  it("uses only the first hop of a multi-value x-forwarded-host", () => {
    const req = makeReq({
      "x-forwarded-host": "alt.example.com, evil.example",
      host: "real.example.com",
    });
    expect(getClerkProxyHost(req, allowed)).toBe("alt.example.com");
  });

  it("rejects a multi-value x-forwarded-host whose first hop is forged (falls back to validated Host)", () => {
    const req = makeReq({
      "x-forwarded-host": "evil.example, alt.example.com",
      host: "real.example.com",
    });
    // First hop is forged; should not return it. Falls back to validated Host.
    expect(getClerkProxyHost(req, allowed)).toBe("real.example.com");
  });

  it("returns undefined when first-hop x-forwarded-host is forged AND Host is forged", () => {
    const req = makeReq({
      "x-forwarded-host": "evil.example, alt.example.com",
      host: "evil.example",
    });
    expect(getClerkProxyHost(req, allowed)).toBeUndefined();
  });

  it("handles array-form x-forwarded-host (Express typings)", () => {
    const req = makeReq({
      "x-forwarded-host": ["alt.example.com", "evil.example"],
      host: "real.example.com",
    });
    expect(getClerkProxyHost(req, allowed)).toBe("alt.example.com");
  });

  it("returns undefined when only the Host header is present and it is forged (fail-closed)", () => {
    const req = makeReq({ host: "evil.example" });
    expect(getClerkProxyHost(req, allowed)).toBeUndefined();
  });

  it("uses the Host header when it is in the allowlist", () => {
    const req = makeReq({ host: "alt.example.com" });
    expect(getClerkProxyHost(req, allowed)).toBe("alt.example.com");
  });

  it("normalizes case and default port before allowlist comparison", () => {
    const req = makeReq({ "x-forwarded-host": "ALT.Example.COM:443" });
    expect(getClerkProxyHost(req, allowed)).toBe("alt.example.com");
  });

  it("returns undefined when the allowlist is empty and no headers match", () => {
    const empty = buildAllowedHosts("");
    const req = makeReq({
      "x-forwarded-host": "evil.example",
      host: "evil.example",
    });
    expect(getClerkProxyHost(req, empty)).toBeUndefined();
  });

  it("returns undefined when there are no headers at all and the allowlist is empty", () => {
    const empty = buildAllowedHosts("");
    expect(getClerkProxyHost(makeReq({}), empty)).toBeUndefined();
  });

  it("falls back to the first allowlist entry when no host headers are present (e.g. internal probe)", () => {
    expect(getClerkProxyHost(makeReq({}), allowed)).toBe("real.example.com");
  });
});

describe("getClerkProxyHost (non-production)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("returns the Host header in development without validating against the allowlist", () => {
    const req = makeReq({ host: "localhost:5173" });
    expect(getClerkProxyHost(req)).toBe("localhost:5173");
  });

  it("returns undefined when no Host header is present in development", () => {
    expect(getClerkProxyHost(makeReq({}))).toBeUndefined();
  });
});
