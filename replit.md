# WashMate

WashMate is a laundry marketplace that connects customers with vetted local washers for pickup, washing, and delivery.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 8080, proxied at /api)
- `pnpm --filter @workspace/washmate run dev` — run the frontend (proxied at /)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string (auto-provisioned)
- Required env: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` — Replit-managed Clerk auth (auto-provisioned via Auth pane)
- Required env: `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key for the web client (auto-provisioned)
- Required env: `FIELD_ENCRYPTION_KEY` — 64-char hex string for AES-256-GCM field encryption
- Required secret: `STRIPE_WEBHOOK_SECRET` — Stripe endpoint signing secret for `/api/stripe/webhook`; subscribe the endpoint to payout settlement and Financial Connections account deactivation/disconnection events

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 + Replit-managed Clerk (`@clerk/express`) auth
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod v3
- Frontend: React + Vite + Tailwind CSS v3 + Wouter routing
- Build: esbuild (CJS bundle for server)

## Where things live

- `artifacts/washmate/` — React frontend (auth, customer dashboard, washer dashboard, washer profile)
- `artifacts/api-server/src/` — Express server (auth routes, order routes, washer profile routes)
- `lib/db/src/schema/` — Drizzle schema (users, sessions, orders, washer_profiles)
- `artifacts/washmate/src/lib/api.ts` — Frontend-side API contract (routes, types, buildUrl)
- `artifacts/api-server/src/shared-routes.ts` — Server-side API contract (uses @workspace/db types)

## Architecture decisions

- Auth uses Replit-managed Clerk: `clerkMiddleware()` populates `getAuth(req)` on the API; the React client uses `<ClerkProvider>` + `<SignIn>/<SignUp>` from `@clerk/react` with the `shadcn` theme from `@clerk/themes`
- Clerk Frontend API is proxied through `/api/__clerk` in production (mounted before body parsers in `app.ts`); proxy is a no-op in dev (Clerk loads JS directly from the dev FAPI host encoded in the publishable key)
- `users.id` stores the Clerk user id (`user_xxx`); a row is lazily upserted on the first authenticated request from data fetched via `clerkClient.users.getUser(userId)`
- iOS app is a WebView shell pointed at the published web URL — Clerk session cookies flow through `sharedCookiesEnabled`/`thirdPartyCookiesEnabled`; no native Clerk SDK
- Sensitive washer profile fields (taxId, routingNumber, accountNumber, etc.) are encrypted at rest with AES-256-GCM using FIELD_ENCRYPTION_KEY
- Frontend uses a local `src/lib/api.ts` (not @workspace/api-client-react) to define the API contract — the original app used a custom typed routes object, preserved in migration
- Custom queryClient in `src/lib/queryClient.ts` is preserved from the original app
- The Wouter Router is wrapped with `base={import.meta.env.BASE_URL}` for correct path-prefixed routing; Clerk's `<SignIn>/<SignUp>` use full `${basePath}/sign-in` paths and a `routerPush/routerReplace` adapter that strips the base before delegating to wouter

## Product

- Customers: register, select customer role + address, create laundry orders, track order status
- Washers: register, select washer role, complete background check verification, claim and fulfill orders
- Sensitive washer financial info is masked (WASHMATE_MASKED) on display
- Role switching from washer to customer blocked if active orders exist (prevents race conditions)

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Run `pnpm --filter @workspace/db run push` after schema changes
- esbuild bundles zod — it must be a direct dependency of @workspace/api-server (not just transitive via @workspace/db)
- The `zod/v4` sub-path import does NOT work with the esbuild bundler — use `from "zod"` in server files
- `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`, and `FIELD_ENCRYPTION_KEY` must be set before the API server starts (the server fails fast on missing Clerk envs)
- To configure auth (login providers, branding, etc.) use the Auth pane in the workspace toolbar — there is no external Clerk dashboard for Replit-managed Clerk
- Do not call `publishableKeyFromHost` in the React app — on Replit dev domains it synthesizes a broken publishable key; use `import.meta.env.VITE_CLERK_PUBLISHABLE_KEY` directly

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
