import { describe, expect, it, vi } from "vitest";

vi.mock("./logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { assertRequiredEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://localhost:5432/test",
  FIELD_ENCRYPTION_KEY: "a".repeat(64),
  STRIPE_SECRET_KEY: "sk_test_xxx",
  STRIPE_PUBLISHABLE_KEY: "pk_test_xxx",
};

describe("startup preflight", () => {
  it("passes with a complete production env", () => {
    expect(() =>
      assertRequiredEnv({
        ...base,
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_xxx",
        ALLOWED_DOMAINS: "washloop.net",
        CHECKR_API_KEY: "checkr_test_key",
        CHECKR_WEBHOOK_SECRET: "whsec_checkr",
        CHECKR_PACKAGE: "washmate_standard",
      }),
    ).not.toThrow();
  });

  it("accepts the Replit Stripe connector in place of explicit keys", () => {
    const { STRIPE_SECRET_KEY: _s, STRIPE_PUBLISHABLE_KEY: _p, ...rest } = base;
    expect(() =>
      assertRequiredEnv({
        ...rest,
        REPLIT_CONNECTORS_HOSTNAME: "connectors.replit.example",
        REPL_IDENTITY: "repl identity-token",
      }),
    ).not.toThrow();
  });

  it("names missing variables without leaking values", () => {
    expect(() => assertRequiredEnv({})).toThrow(
      /DATABASE_URL.*FIELD_ENCRYPTION_KEY.*STRIPE_SECRET_KEY/,
    );
    expect(() => assertRequiredEnv({})).not.toThrow(/postgres:\/\//);
  });

  it("requires the webhook secret in production", () => {
    expect(() =>
      assertRequiredEnv({ ...base, NODE_ENV: "production", ALLOWED_DOMAINS: "washloop.net" }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("warns (not throws) for missing Checkr config in production", () => {
    expect(() =>
      assertRequiredEnv({
        ...base,
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_xxx",
        ALLOWED_DOMAINS: "washloop.net",
      }),
    ).not.toThrow();
  });

  it("warns (not throws) for missing Checkr config outside production", () => {
    expect(() => assertRequiredEnv({ ...base })).not.toThrow();
  });

  it("requires the webhook secret in production", () => {
    expect(() =>
      assertRequiredEnv({ ...base, NODE_ENV: "production", ALLOWED_DOMAINS: "washloop.net" }),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);
  });

  it("requires deployment domains in production", () => {
    expect(() =>
      assertRequiredEnv({
        ...base,
        NODE_ENV: "production",
        STRIPE_WEBHOOK_SECRET: "whsec_xxx",
      }),
    ).toThrow(/ALLOWED_DOMAINS/);
  });

  it("rejects an unknown Connect account type", () => {
    expect(() =>
      assertRequiredEnv({ ...base, STRIPE_CONNECT_ACCOUNT_TYPE: "standard" }),
    ).toThrow(/STRIPE_CONNECT_ACCOUNT_TYPE/);
  });

  it("accepts explicit custom and express Connect account types", () => {
    expect(() =>
      assertRequiredEnv({ ...base, STRIPE_CONNECT_ACCOUNT_TYPE: "custom" }),
    ).not.toThrow();
    expect(() =>
      assertRequiredEnv({ ...base, STRIPE_CONNECT_ACCOUNT_TYPE: "express" }),
    ).not.toThrow();
  });
});
