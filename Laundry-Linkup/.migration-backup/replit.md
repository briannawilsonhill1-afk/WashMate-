# WashMate - Laundry Marketplace Platform

## Overview
WashMate is a premium laundry marketplace connecting customers with washers (service providers). Features a "Fresh Laundry" aesthetic with ocean blue theming.

## Architecture
- **Frontend**: React 18 + Vite + TailwindCSS + Shadcn UI + Framer Motion
- **Backend**: Express.js with Drizzle ORM (PostgreSQL)
- **Routing**: wouter (client-side)
- **State**: TanStack Query for server state
- **Auth**: Self-hosted email + password (bcryptjs, express-session, PG-backed sessions)

## Pages
| Path | Component | Access |
|------|-----------|--------|
| `/` | Redirect | Redirects based on auth |
| `/auth` | AuthPage | Public |
| `/customer` | CustomerDashboard | Customer role |
| `/washer` | WasherDashboard | Washer role |
| `/privacy` | PrivacyPolicy | Public |
| `/washer/profile` | WasherProfile | Washer role |

## Key Files
- `shared/schema.ts` - Data models (users, orders, washerProfiles)
- `server/routes.ts` - API endpoints
- `server/storage.ts` - Storage interface
- `client/src/App.tsx` - Router and app shell
- `client/src/components/layout/Navbar.tsx` - Navigation bar
- `client/src/hooks/use-auth.ts` - Auth state management (TanStack Query)
- `server/auth.ts` - Email + password auth (bcrypt, express-session)
- `client/src/pages/PrivacyPolicy.tsx` - Privacy policy page
- `client/src/pages/WasherProfile.tsx` - Washer payment & contractor info

## Order Options
- **Pet Hair**: informational flag, no extra fee
- **Heavily Soiled**: +$15 surcharge, with optional notes
- **Soap Preference**: customer_provided or washer_provided (washer-provided must be hypoallergenic per policy)
- **Extra Folding**: +$10
- **Distance-based pickup fee**: $1/mile (min $5)

## Dependencies
- minimatch@10.2.1 (security override)
