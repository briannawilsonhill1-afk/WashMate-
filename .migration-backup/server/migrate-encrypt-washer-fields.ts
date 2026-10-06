import { db } from "./db";
import { washerProfiles } from "@shared/schema";
import { encryptField, isEncrypted } from "./encryption";
import { eq } from "drizzle-orm";

const ENCRYPTED_FIELDS = [
  "legalName",
  "dateOfBirth",
  "phone",
  "taxId",
  "businessName",
  "bankName",
  "accountHolderName",
  "routingNumber",
  "accountNumber",
  "county",
  "state",
] as const;

type EncField = typeof ENCRYPTED_FIELDS[number];

function maybeEncryptValue(value: string | null): string | null {
  if (value == null || value === "") return value;
  return isEncrypted(value) ? value : encryptField(value);
}

async function backfillEncryption() {
  console.log("Starting encryption backfill for washer_profiles...");

  const profiles = await db.select().from(washerProfiles);
  console.log(`Found ${profiles.length} washer profile(s) to check.`);

  let updated = 0;
  for (const profile of profiles) {
    const updates: Partial<Record<EncField, string>> = {};
    let needsUpdate = false;

    for (const field of ENCRYPTED_FIELDS) {
      const current = profile[field] as string | null;
      if (current == null || current === "") continue;
      if (isEncrypted(current)) continue;
      const enc = maybeEncryptValue(current);
      if (enc != null) updates[field] = enc;
      needsUpdate = true;
    }

    if (!needsUpdate) {
      console.log(`Profile userId=${profile.userId}: already encrypted, skipping.`);
      continue;
    }

    await db
      .update(washerProfiles)
      .set(updates)
      .where(eq(washerProfiles.userId, profile.userId));

    console.log(
      `Profile userId=${profile.userId}: encrypted fields [${Object.keys(updates).join(", ")}].`,
    );
    updated++;
  }

  console.log(`Backfill complete. Updated ${updated} of ${profiles.length} profile(s).`);
  process.exit(0);
}

backfillEncryption().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
