---
id: "wm-20260421-washer-pii-stored-and-returned-in-cleartext"
title: "Washer tax IDs and bank details are stored and returned in cleartext"
level: HIGH
files:
  - "shared/schema.ts"
  - "shared/routes.ts"
  - "server/storage.ts"
  - "server/routes.ts"
  - "client/src/pages/WasherDashboard.tsx"
  - "client/src/pages/WasherProfile.tsx"
state: NOT_FIXED
---

WashMate stores washer tax IDs and bank-account details as ordinary text and sends the full values back to the browser whenever the washer profile is fetched or saved. A database leak, backup exposure, or hijacked washer session would therefore reveal enough information for identity theft and payout fraud.

The root cause is that the most sensitive onboarding fields are treated exactly like normal profile data. In `shared/schema.ts`, `taxId`, `routingNumber`, and `accountNumber` are defined as plain `text` columns in `washer_profiles` with no field-level encryption, tokenization, or masking. In `server/storage.ts`, `upsertWasherProfile()` writes these values directly into PostgreSQL via `{ ...profile }`, again with no protection. Then `server/routes.ts` returns the entire stored record from both `GET /api/washer-profile` and `POST /api/washer-profile` using `res.status(200).json(profile)`, and `shared/routes.ts` formally defines those endpoints as returning the full `washerProfiles` row.

This means exposure is not limited to a database compromise. Any attacker who steals a washer's authenticated session can call `GET /api/washer-profile` and immediately retrieve the washer's full tax ID, routing number, and account number. The frontend widens that exposure further: `client/src/pages/WasherProfile.tsx` copies the raw values into React state and renders them back into ordinary text inputs, and `client/src/pages/WasherDashboard.tsx` also fetches the same endpoint just to learn `bgCheckStatus`, causing the complete payout dataset to traverse the browser on routine dashboard visits even when the page does not need those fields. Because these values are neither masked after initial collection nor vaulted behind a payment processor or dedicated secret store, a single application or database read discloses the complete financial identity bundle for every washer.
