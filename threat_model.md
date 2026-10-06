# Threat Model

## Project Overview

WashMate is a laundry marketplace with a React web frontend, an Express 5 API server, a PostgreSQL database accessed through Drizzle ORM, and an iOS WebView shell that loads the published web app. Users authenticate with Replit-managed Clerk, choose a customer or washer role, place or claim laundry orders, and receive order-status updates. The highest-sensitivity workflows are Clerk-backed authentication, customer address handling, washer onboarding and payout data, and the mobile push-notification channel.

Production assumptions for this scan:
- `NODE_ENV` is `production` in deployed environments.
- Replit terminates TLS for deployed traffic.
- `artifacts/mockup-sandbox/` is dev-only and should be ignored unless production reachability is demonstrated.

## Assets

- **User accounts and Clerk sessions** — Clerk identities, session cookies, and the local `users` table keyed by Clerk user id. Compromise would allow account takeover and order manipulation.
- **Customer location data** — customer addresses stored on user profiles and copied onto active orders. Disclosure exposes physical location and routine information.
- **Washer onboarding and payout data** — legal name, date of birth, phone number, tax ID, county/state, and bank account metadata. This is the most sensitive dataset in the app.
- **Order records** — order status, service preferences, soil notes, recurring schedule, and assignment state. Integrity matters for payment, fulfillment, and physical pickup.
- **Push-notification identifiers and channel integrity** — Expo push tokens and notification payloads linked to users and devices. Misbinding or spoofing can leak order activity or drive phishing through trusted notifications.
- **Application secrets** — `DATABASE_URL`, `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `FIELD_ENCRYPTION_KEY`. Exposure would undermine authentication, confidentiality, or database integrity.

## Trust Boundaries

- **Browser / mobile app to API** — all client input is untrusted. The API must authenticate every protected request and enforce role checks server-side.
- **API to Clerk** — the API validates auth state and proxies Clerk frontend traffic with a secret key. Hostname and proxy metadata must not be attacker-controlled.
- **API to PostgreSQL** — the API has broad database access. Any injection or broken authorization at the API layer risks exposure of orders, PII, and washer financial data.
- **Authenticated customer / authenticated washer boundary** — customers and washers are separate roles with different data access. Customer addresses must only cross to the assigned cleared washer for an active order.
- **General authenticated user / sensitive washer-profile boundary** — only the owning authenticated user should access or mutate their washer profile; masked fields should not be re-exposed unnecessarily.
- **Native iOS shell / embedded web app boundary** — the mobile wrapper has access to device-only capabilities such as push tokens and must not expose them to arbitrary web origins or untrusted DOM code.
- **API to third-party push service** — the server sends push notifications to Expo using stored device tokens. Tokens must stay bound to the correct user and outbound notifications must not become a spoofing channel.
- **Production / dev-only boundary** — mockup sandbox and local build scripts are out of production scope unless code paths prove otherwise.

## Scan Anchors

- **Production entry points:** `artifacts/api-server/src/index.ts`, `artifacts/api-server/src/app.ts`, `artifacts/api-server/src/auth.ts`, `artifacts/api-server/src/routes/routes.ts`, `artifacts/washmate/src/main.tsx`, `artifacts/washmate-ios/app/index.tsx`.
- **Highest-risk code areas:** Clerk proxy/auth setup in `artifacts/api-server/src/auth.ts` and `artifacts/api-server/src/middlewares/clerkProxyMiddleware.ts`; order and address authorization in `artifacts/api-server/src/routes/routes.ts` (especially `extractPickupArea()` and address-release paths); storage and encryption in `artifacts/api-server/src/storage.ts` and `artifacts/api-server/src/encryption.ts`; mobile push-token handling in `artifacts/washmate-ios/app/index.tsx`, `artifacts/washmate/src/hooks/use-push-registration.ts`, and `artifacts/washmate/src/hooks/use-auth.ts`.
- **Public surfaces:** `GET /api/healthz`, Clerk proxy traffic under `/api/__clerk/*`.
- **Authenticated surfaces:** `/api/auth/user`, `/api/me/profile`, `/api/orders*`, `/api/washer-profile*`, `/api/device-tokens`.
- **Usually ignore as dev-only:** `artifacts/mockup-sandbox/`, `.migration-backup/`, migration/backfill scripts unless production reachability is shown.

## Threat Categories

### Spoofing

WashMate relies on Clerk-backed sessions and a secret-backed Clerk frontend proxy. The application must ensure protected routes only trust authenticated Clerk state, and the proxy/auth handshake must derive its external host only from trusted deployment metadata. The Clerk proxy must also derive client network identity from trusted proxy state rather than attacker-supplied forwarding headers. The mobile push channel must not allow attackers to impersonate WashMate notifications by stealing device tokens.

### Tampering

Customers can submit order parameters and washers can transition orders through fulfillment states, but the server must remain the source of truth for fees, assignment, and legal status transitions. Role changes, order claims, and order-status changes must be enforced server-side and remain race-safe under concurrent requests. Device-token registration must not let one user rebind another user's notification channel without proof of possession.

### Information Disclosure

The platform handles physical addresses and sensitive washer onboarding data. Customer addresses must only be revealed to the cleared washer assigned to an active order, and any pre-claim “general area” view must avoid leaking apartment, unit, or building metadata through free-form address parsing. Washer financial fields must stay encrypted at rest and masked in normal API responses, and mobile-only secrets such as push tokens must not be exposed to arbitrary WebView content or third-party pages. Push-token ownership must also fail safe across logout errors or shared-device reuse so one account’s notifications do not continue to reach a later user of the same handset.

### Denial of Service

Public authentication endpoints and any unauthenticated or lightly protected APIs must resist abuse. Expensive operations such as Clerk proxy requests, login attempts, broad order listing, or external-notification paths should not allow one user to degrade service for others.

### Elevation of Privilege

A customer must not be able to claim jobs, inspect another user's order data, or access addresses without being the assigned cleared washer. A washer must not be able to bypass role restrictions or mutate orders outside the allowed lifecycle. All database access must stay parameterized, and trusted infrastructure headers or native/mobile capabilities must not become a path to broaden privileges or trusted origins.