# Threat Model

## Project Overview

WashMate is a React + Vite frontend with an Express + TypeScript backend and PostgreSQL storage. It is a two-sided laundry marketplace where authenticated users choose a role (`customer` or `washer`), customers create laundry pickup orders, and washers claim and complete jobs. Authentication is self-hosted email + password using `bcryptjs`, `express-session`, and a PostgreSQL-backed session store.

Production assumptions for this scan: `NODE_ENV=production`, TLS termination is handled by the platform, and dev-only tooling is not deployed. The production server entry point is `server/index.ts`, which registers API routes from `server/routes.ts` and serves static assets from `server/static.ts`.

## Assets

- **User accounts and sessions** — email addresses, password hashes, session cookies, and persisted session rows. Compromise allows impersonation and access to protected marketplace actions.
- **Customer PII** — home addresses stored on user profiles and copied onto orders, plus free-form laundry notes and service preferences. Exposure creates privacy and physical-safety risk.
- **Washer PII and financial data** — legal names, dates of birth, phone numbers, tax IDs, bank routing numbers, account numbers, and background-check status in `washer_profiles`. Compromise would expose highly sensitive identity and payout data.
- **Marketplace workflow integrity** — order ownership, claim status, status transitions, and pricing fields (`flatFee`, `pickupFee`, `soiledFee`, `totalFee`). Tampering can affect who gets access to jobs and what the platform believes a job is worth.
- **Application secrets and database access** — `SESSION_SECRET`, `FIELD_ENCRYPTION_KEY`, `DATABASE_URL`, persisted session data, and encrypted washer-profile fields.

## Trust Boundaries

- **Browser to API** — all registration, login, role selection, order creation, washer onboarding, and status changes cross from an untrusted client into the Express API.
- **API to PostgreSQL** — `server/storage.ts` and `server/auth.ts` persist user profiles, password hashes, order data, washer payout details, and sessions.
- **Public vs authenticated surfaces** — `/api/register`, `/api/login`, `/api/logout`, and the static frontend are public; all marketplace data routes are intended to require an authenticated session.
- **Customer vs washer privilege boundary** — customers create orders and store addresses; washers can browse eligible jobs, claim orders, and retrieve customer addresses only after server-side authorization and background-check clearance.
- **Production vs dev-only boundary** — `server/vite.ts`, `server/seed.ts`, and build/development tooling are dev-only unless separately proven reachable in production and should usually be ignored in production scans.

## Scan Anchors

- **Production entry points:** `server/index.ts`, `server/auth.ts`, `server/routes.ts`, `server/storage.ts`
- **Highest-risk code areas:** `server/auth.ts`, `server/routes.ts`, `server/storage.ts`, `server/encryption.ts`, `shared/schema.ts`, `shared/routes.ts`, `client/src/pages/RoleSelection.tsx`, `client/src/pages/WasherDashboard.tsx`, `client/src/pages/WasherProfile.tsx`
- **Sensitive disclosure points:** `POST /api/me/profile`, `GET /api/orders`, `GET /api/orders/:id/customer-address`, `GET /api/washer-profile`, `POST /api/washer-profile`, PostgreSQL `users.password_hash`, PostgreSQL `sessions.sess`
- **Public surfaces:** `/api/register`, `/api/login`, `/api/logout`, `/`, `/auth`, `/privacy`
- **Authenticated surfaces:** `/api/auth/user`, `/api/me/profile`, `/api/orders*`, `/api/washer-profile*`
- **Dev-only areas to usually ignore:** `server/vite.ts`, `server/seed.ts`, build output in `dist/`

## Threat Categories

### Spoofing

All protected API endpoints must require a valid authenticated session derived from the server-side email/password flow. Password hashes must never leave the server/database boundary, session cookies must remain unpredictable, and session lifetime must be enforced consistently across both the browser cookie and the PostgreSQL session store so stolen session identifiers cannot outlive the intended auth window. Public authentication endpoints must resist credential-stuffing and online password-guessing attacks rather than relying only on bcrypt cost.

### Tampering

The browser is untrusted. Role changes, washer verification state, order pricing, and order status transitions must be enforced server-side instead of trusting fields supplied by the client. Any data that grants new privileges or changes what a washer can claim must be derived from trusted back-end logic rather than accepted from request bodies, and order workflow transitions must follow an explicit server-side state machine. Any state-changing route that relies on a session cookie must continue to enforce explicit CSRF defenses rather than depending on browser defaults alone.

### Information Disclosure

Customer addresses, washer tax IDs, bank-account details, password hashes, and session-linked user records must only be disclosed to the minimal authorized principal and only when strictly needed for the current workflow. `POST /api/me/profile` and other account/profile routes must shape responses to exclude credential material, `GET /api/orders` must not broadcast customer free-form notes or unnecessary order details to all washers before assignment, and `GET /api/washer-profile` must avoid overexposing payout/tax data to pages that only need background-check state. Sensitive onboarding data should remain encrypted or otherwise shielded from routine database reads and browser-side overexposure.

### Elevation of Privilege

Customer and washer roles must be enforced on the server for every state-changing route. A user must not be able to self-grant privileged washer capabilities, bypass verification gates, or gain access to customer address data by manipulating request fields or stale historical order assignments. Previous access obtained during one workflow state must not silently persist after role changes or after an order moves out of the active fulfillment lifecycle.

### Repudiation

Sensitive actions such as logging in, changing a role, updating payout details, claiming an order, changing order status, and disclosing a customer address should remain attributable to the acting authenticated user. Logging should support incident investigation without becoming a secondary source of PII leakage.