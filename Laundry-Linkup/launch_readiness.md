# WashMate Launch-Readiness Review

**Review date:** September 23, 2026  
**Scope:** WashMate web app, API, PostgreSQL-backed workflows, Stripe bank/payout flows, production deployment, and iOS WebView shell  
**Method:** Read-only code review, current workflow/build/test evidence, deployment metadata, production HTTP checks, and a visual check of the public landing page  
**Decision:** **NO-GO for a general public marketplace launch**

## Executive summary

WashMate has a healthy public landing page and API process, server-enforced role boundaries around core order actions, encrypted sensitive washer fields at rest, and meaningful automated coverage around notifications and several order/payout cases. The current production deployment is public, its build is successful, and both `https://washloop.net/` and `https://washloop.net/api/healthz` returned HTTP 200 during this review.

The product is not ready for a general launch because three core paths are not safe or operational:

1. **Payout settlement can be attached to the wrong local payout, and Connect-account creation is not concurrency-safe.**
2. **New washers cannot complete background verification through the application, so they cannot claim or fulfill orders.**
3. **The iOS shell loads a hardcoded hostname that currently returns HTTP 404.**

Stripe Connect onboarding also records Terms of Service acceptance with the loopback address `127.0.0.1`, rather than a verified washer acceptance context. Production startup and health checks do not validate all dependencies required for money movement and encrypted data.

A limited internal web pilot could be considered only after the financial-integrity, washer-activation, Stripe onboarding, and production-readiness gates below pass. The iOS blocker can be deferred only if iOS is explicitly excluded from that pilot.

## Current production snapshot

| Area | Evidence | Assessment |
|---|---|---|
| Deployment | Replit deployment metadata reports public Autoscale deployment, successful current build, primary URL `https://washloop.net` | Healthy baseline |
| Public web | `GET https://washloop.net/` returned 200; landing page rendered successfully in a visual check | Healthy baseline |
| API liveness | `GET https://washloop.net/api/healthz` returned `{"status":"ok"}` | Process is reachable, but this is liveness only |
| Auth assets | Current deployment logs show Clerk proxy assets and environment/client requests returning 200/307 as expected | No immediate auth-load error observed |
| Development artifacts | Web, API, and Expo artifact workflows are running | Healthy artifact workflows |
| Default workflow | `Start application` fails because the root package has no `dev` script | Operational cleanup; not a production blocker |
| Automated checks | Full workspace typecheck passed during the review; current web notification workflow reports 2 files / 16 tests passing | Useful but insufficient for launch |
| iOS target | `artifacts/washmate-ios/app/index.tsx` points to `laundry-linkup--briannawilsonhi.replit.app`; that host returned 404 | Launch blocker for iOS |

## Launch blockers

### 1. Payout reconciliation is not deterministically bound to a local payout

**Severity:** Critical  
**Area:** Financial integrity  
**Evidence:** `artifacts/api-server/src/routes/stripeWebhook.ts`

The payout webhook first matches by Stripe payout ID, then by `washmatePayoutId` metadata. If neither is available, it falls back to a pending payout for the Connect account:

- `findPendingPayoutByConnectAccountId(connectAccountId)` is used as a final match.
- The storage query returns the newest pending payout for that account.
- An automatic Stripe payout can aggregate funds or arrive without WashMate metadata.

That fallback does not prove that the Stripe settlement corresponds to the selected local payout. With more than one pending payout, a paid or failed event can be applied to the wrong row, changing order-payment state incorrectly.

**Required before launch**

- Remove ambiguous “newest pending payout” reconciliation.
- Persist a deterministic relationship between each local payout and the Stripe object/event that settles it.
- Define and handle automatic-payout aggregation explicitly, or disable automatic payouts and use only WashMate-created payout objects.
- Add sandbox tests for multiple pending payouts, duplicate/out-of-order webhooks, automatic payouts, and webhook retries.
- Reconcile any existing pending production rows before enabling live payouts.

### 2. Connect-account provisioning can create duplicate Stripe accounts

**Severity:** Critical  
**Area:** Financial integrity / payout routing  
**Evidence:** `artifacts/api-server/src/payoutService.ts`, `artifacts/api-server/src/routes/routes.ts`

`ensureConnectAccount()` performs a read-then-create sequence:

1. Read the washer profile.
2. Return the existing Connect account ID if present.
3. Otherwise create a Stripe Custom account and attach the bank.
4. Save the new account ID.

There is no database lock, reservation state, or Stripe idempotency key around account creation. Concurrent calls can therefore create multiple Connect accounts for one washer. This is realistic because Financial Connections completion starts `ensureConnectAccount()` asynchronously while a payout request can invoke it again.

**Required before launch**

- Serialize Connect-account creation per washer using a database lock/state transition.
- Use Stripe idempotency where the API supports it.
- Safely recover orphaned accounts if Stripe creation succeeds but local persistence fails.
- Verify that bank attachment and retries cannot route a payout through a stale account.
- Add a real-database concurrency test.

### 3. Washer background verification never reaches a terminal state

**Severity:** Critical  
**Area:** Marketplace operations / trust and safety  
**Evidence:** `artifacts/api-server/src/storage.ts`, `artifacts/api-server/src/routes/routes.ts`

When a washer consents, self-certifies, and provides county/state, profile persistence can change `bgCheckStatus` from `not_started` to `pending`. No application code changes it from `pending` to `cleared` or `flagged`.

At the same time:

- Pending jobs are shown only to washers whose status is `cleared`.
- Claiming an order requires `cleared`.
- Accessing a claimed customer's address requires `cleared`.
- The public landing page states that every washer passes a background check.

Without a provider workflow or controlled administrative review path, new washer supply is permanently blocked unless someone edits the database outside the application.

**Required before launch**

- Implement an auditable verification workflow that produces `cleared` or `flagged`.
- Restrict status changes to a trusted provider webhook or authorized internal operator action.
- Record provider/reference information and review timestamps without exposing sensitive findings to customers or unrelated staff.
- Cover consent, resubmission, provider failure, flagged results, and status-transition authorization.
- Verify that marketing and consent text match the actual screening process and applicable legal requirements.

### 4. The iOS app opens a dead production host

**Severity:** Critical if iOS is in launch scope  
**Area:** Mobile availability  
**Evidence:** `artifacts/washmate-ios/app/index.tsx`, current deployment metadata, direct HTTP check

The WebView URL, first-party host allowlist, and origin whitelist are hardcoded to:

`https://laundry-linkup--briannawilsonhi.replit.app`

That host returned HTTP 404 during this review. The current primary production URL is `https://washloop.net`; the deployment also reports `https://laundry-linkup.replit.app` as an additional URL.

Because the host allowlist is also hardcoded, changing only the initial URL would not be enough.

**Required before an iOS launch**

- Configure one canonical production URL at build time and derive all WebView host checks from it.
- Point the release build to `washloop.net` or another verified canonical domain.
- Test sign-in cookies, external-link handoff, push-token injection, cold-start notification routing, logout/device reuse, and navigation after a production build.
- Add automated tests for host validation and deep-link routing.

If launch is web-only, document that iOS is excluded and do not distribute the current build.

### 5. Stripe Custom-account Terms acceptance uses a synthetic IP address

**Severity:** High  
**Area:** Compliance / account onboarding  
**Evidence:** `artifacts/api-server/src/payoutService.ts`

Custom account creation sends:

```text
tos_acceptance.date = current server time
tos_acceptance.ip = 127.0.0.1
```

This records the server loopback address rather than evidence of the washer's actual acceptance. The local `agreedToTerms` checkbox is also not tied to a versioned Stripe Connect onboarding record.

**Required before launch**

- Confirm the approved Stripe Connect onboarding model for this business.
- Prefer Stripe-hosted or embedded Connect onboarding where possible.
- If platform-collected acceptance is permitted, collect and persist the required acceptance evidence, document version, and real client context through a trusted proxy boundary.
- Have counsel/Stripe requirements confirm the contractor, identity, tax, and background-check disclosures before live onboarding.

### 6. Production preflight and readiness checks are incomplete

**Severity:** High  
**Area:** Reliability / recoverability  
**Evidence:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/routes/health.ts`, `replit.md`

Startup fails fast for Clerk keys, and database initialization fails if `DATABASE_URL` is absent. It does not explicitly validate other launch-critical configuration such as:

- `FIELD_ENCRYPTION_KEY`
- Stripe API configuration
- `STRIPE_WEBHOOK_SECRET`
- production origin/domain configuration
- administrative payout configuration, if bulk/manual payout operations are part of launch

`/api/healthz` always returns `{"status":"ok"}` without checking database connectivity or required schema. A deployment can therefore pass its health check while authenticated order and payout workflows are unusable.

This review did not inspect secret values or mutate production, so it does not assert that production configuration is missing. It establishes that the application does not prove readiness itself.

**Required before launch**

- Add a startup preflight for required configuration, with no secret values in logs.
- Add a readiness endpoint that checks database connectivity and required schema with a short timeout.
- Keep simple liveness separate from readiness.
- Verify the public Stripe webhook endpoint, subscribed event list, signing secret, retry behavior, and visibility against the exact production URL.
- Review the development-to-production schema diff during publishing and reject destructive changes unless explicitly intended.
- Create an operator runbook for failed payouts, stuck pending payouts, webhook replay, provider outages, and rollback.

## High-priority quality and privacy gaps

These should be fixed before a broad launch; they may be accepted temporarily only for a tightly controlled pilot with a documented owner and deadline.

### Core order creation is not fully keyboard- or screen-reader-accessible

**Evidence:** `artifacts/washmate/src/pages/CustomerDashboard.tsx`

- The schedule modal lacks dialog semantics, accessible labelling, focus trapping, Escape handling, and focus restoration.
- Load-size choices are clickable `<div>` elements rather than buttons/radios, so keyboard users cannot operate them.
- Several other visual selection groups do not expose selected state semantically.

Because order creation is the product's primary customer conversion flow, this is more than cosmetic polish.

### Washer-profile responses return more decrypted PII than the UI needs

**Evidence:** `artifacts/api-server/src/routes/routes.ts`, `artifacts/api-server/src/shared-routes.ts`

The API masks tax ID, routing number, and account number, but spreads the full decrypted profile into the response. That sends legal name, date of birth, phone, county/state, and provider identifiers to the browser even when individual screens may not need all fields.

Use explicit response DTOs, return the minimum fields per screen, and keep provider/internal identifiers server-side.

### Payout failure details need a stable redaction boundary

**Evidence:** `artifacts/api-server/src/routes/routes.ts`

Washer payout history returns `failureReason`, and the admin bulk payout endpoint returns raw caught error messages. Current work already tracks this area:

- **#70 — Keep provider details out of washer payout history**
- **#71 — Protect the existing payout validation messages**

Complete those tasks before enabling live payouts.

### No authenticated end-to-end launch test has been demonstrated

The current tests exercise useful units and route behavior, but this review found no current browser-level proof of the complete marketplace lifecycle:

1. customer sign-up and role setup
2. order creation
3. cleared washer discovery and claim
4. status progression and address release
5. completion and earnings
6. bank verification
7. payout initiation
8. Stripe webhook settlement
9. customer/washer notification behavior

Run this in a Stripe sandbox against a production-like database and published staging build before launch. Do not use live money or real sensitive identity data.

## Existing task mapping

The following active tasks already cover launch-adjacent work and should not be duplicated:

| Task | Launch relevance |
|---|---|
| #67 — Keep notification controls usable when device storage is unavailable | Notification reliability |
| #68 — Prevent another washer's bank session from being attached | Financial Connections authorization regression coverage |
| #69 — Keep incomplete bank verification from attaching an empty account | Financial Connections completion regression coverage |
| #70 — Keep provider details out of washer payout history | Payout privacy/redaction |
| #71 — Protect the existing payout validation messages | Stable safe payout errors |
| #72 — Confirm uninstalled-device cleanup stays safe with multiple API servers | Multi-instance notification cleanup |
| #73 — Make exhausted notification cleanup visible to operators | Notification operations |
| #74 — Prevent duplicate Stripe refreshes when WashMate scales up | Multi-instance Stripe dashboard scheduling |

Those tasks do **not** resolve deterministic payout settlement, duplicate Connect-account creation, washer-verification completion, production readiness, or the broken iOS host.

## Minimum launch gate

The launch decision can change to **GO** only when all in-scope items below have evidence attached:

### Financial and Stripe

- [ ] Payout webhook reconciliation is deterministic under multiple pending payouts and event retries.
- [ ] Connect-account creation is concurrency-safe and recoverable.
- [ ] Stripe Connect onboarding and Terms acceptance follow the approved Stripe model.
- [ ] Financial Connections ownership and empty-account cases are covered by #68 and #69.
- [ ] Provider failure details are redacted while user-facing validation stays useful (#70 and #71).
- [ ] A complete Stripe sandbox payout reaches a final local `paid`/`failed` state through a signed webhook.
- [ ] Automatic payout behavior is explicitly configured and tested.

### Marketplace operations and trust

- [ ] New washers can move from consent to an auditable `cleared` or `flagged` decision.
- [ ] Only trusted server/provider/admin paths can change verification status.
- [ ] A cleared washer can claim and complete an order; a non-cleared washer cannot.
- [ ] Operational ownership exists for disputes, incident debt, failed background checks, and stuck orders.

### Production readiness

- [ ] Required configuration is validated before the API accepts traffic.
- [ ] Readiness verifies database connectivity and required schema.
- [ ] The production Stripe webhook uses the exact public deployment URL and correct subscribed events.
- [ ] Production schema changes have been reviewed during publishing.
- [ ] Monitoring/alerts cover API readiness, webhook failures, payout failures, and stuck pending payouts.
- [ ] Backup/restore and rollback procedures have been exercised.

### Customer experience

- [ ] The create-order modal and selection controls meet basic keyboard and screen-reader requirements.
- [ ] An authenticated production-like smoke test covers customer and washer critical paths.
- [ ] Privacy policy, contractor terms, background-check consent, support path, refund/cancellation rules, and service-area expectations match actual behavior.

### iOS, if included

- [ ] Release WebView uses the current canonical production URL.
- [ ] Host allowlisting, authentication cookies, push registration, deep links, external links, and logout/device reuse pass on a release build.
- [ ] App Store privacy disclosures and production push credentials are verified.

## Post-launch improvements

These are valuable but should follow the launch gate:

- Add direct order-detail endpoints so the detail page does not fetch and scan the complete order list.
- Add structured metrics for signup, order creation, claim time, fulfillment time, payout latency, webhook failures, and notification delivery.
- Add request correlation across API logs, Stripe object IDs, and local payout/order IDs without logging PII.
- Reduce washer-profile payloads to purpose-specific response objects.
- Add iOS unit/integration coverage rather than relying only on TypeScript compilation.
- Fix the root `Start application` workflow or remove it so operators do not mistake it for the artifact workflows.
- Add graceful error UI for order-list and profile-query failures instead of collapsing failures into empty/not-found states.

## Positive controls already present

The no-go decision should not obscure controls that are working:

- Authentication and role checks are enforced server-side for protected order and payout routes.
- Order claiming is guarded in storage as well as the route layer.
- Exact customer addresses are restricted to the assigned cleared washer.
- The current pending-order area helper fails closed and returns only state/ZIP; the earlier free-form address concern is not present in the reviewed code.
- Sensitive washer fields are encrypted at rest and the highest-risk bank/tax values are masked in normal profile responses.
- Financial Connections completion re-fetches the Stripe session and verifies the session customer belongs to the authenticated washer.
- Payout transfer and payout creation use deterministic idempotency keys.
- Stripe webhooks are mounted before JSON parsing so signature verification receives the raw body.
- The iOS WebView rejects non-HTTPS and non-first-party navigations from the embedded context.
- Request logging redacts authorization headers and cookies.

## Review limitations

- No production data was queried or changed.
- No secrets or credential values were inspected.
- No live Stripe object was created, modified, or paid.
- No authenticated production user journey was executed.
- The HTTP and visual checks prove reachability and initial rendering, not business-flow correctness.
- Legal, insurance, employment classification, background-check, tax, and App Store compliance require qualified human review.
