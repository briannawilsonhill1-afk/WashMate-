// Address privacy helpers for the public job board.
//
// Customer addresses are stored as free-form strings (see profileUpdateSchema
// in lib/db/src/schema/schema.ts). Before a washer claims an order we must
// expose only a coarse "general area" so cleared washers can decide whether
// to claim, without leaking unit / apartment / building details or the exact
// street.
//
// Design goals:
//   * Drop the street segment.
//   * Never surface unit / apartment / suite / building / floor / room / lot
//     tokens, even when they appear in the second comma-separated segment.
//   * Return only state / ZIP components, never a free-form segment such as a
//     city, building, complex, landmark, or delivery instruction.
//   * If we cannot confirm a state / ZIP tail, fail closed and return null —
//     the client falls back to a "hidden until claimed" placeholder.

const UNIT_SEGMENT_PATTERN =
  /^(?:#|apt\.?|apartment|unit|ste\.?|suite|bldg\.?|building|fl\.?|floor|rm\.?|room|lot|trailer|trlr|space|spc|pmb|po\s*box|p\.?o\.?\s*box)\b/i;

// Single short token that looks like a bare unit number ("4B", "#12"). We cap
// at 4 digits so a bare 5-digit US ZIP code (e.g. "62701") is NOT treated as
// a unit — otherwise we would strip the only locality token and fail closed
// on perfectly valid "Street, City, ZIP" inputs.
const BARE_UNIT_PATTERN = /^#?\d{1,4}[A-Za-z]?$/;

const US_STATE =
  /^(?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY])$/i;
const US_ZIP = /^(\d{5})(?:-\d{4})?$/;
const US_STATE_ZIP =
  /^((?:A[KLRZ]|C[AOT]|D[CE]|FL|GA|HI|I[ADLN]|K[SY]|LA|M[ADEINOST]|N[CDEHJMVY]|O[HKR]|PA|RI|S[CD]|T[NX]|UT|V[AT]|W[AIVY]))\s+(\d{5})(?:-\d{4})?$/i;

function looksLikeUnitSegment(segment: string): boolean {
  if (!segment) return true;
  if (UNIT_SEGMENT_PATTERN.test(segment)) return true;
  if (BARE_UNIT_PATTERN.test(segment)) return true;
  return false;
}

/**
 * Returns a privacy-safe approximation of a pickup address for the public job
 * board, or null if no safe area can be derived. Exported for unit testing.
 */
export function extractPickupArea(
  address: string | null | undefined,
): string | null {
  if (!address) return null;

  const parts = address
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  // Single-line / unparseable input: cannot safely derive an area.
  if (parts.length < 2) return null;

  // Drop the first segment (street address) and any subsequent segments that
  // look like unit / apartment / building tokens. This handles "123 Main St,
  // Apt 4B, Springfield, IL 62701" as well as "123 Main St, Apt 4B" (which
  // previously leaked "Apt 4B").
  const localityParts = parts.slice(1).filter((p) => !looksLikeUnitSegment(p));

  if (localityParts.length === 0) return null;

  const last = localityParts.at(-1)!;
  const stateZip = last.match(US_STATE_ZIP);
  if (stateZip) return `${stateZip[1].toUpperCase()} ${stateZip[2]}`;
  if (US_STATE.test(last)) return last.toUpperCase();
  const zip = last.match(US_ZIP);
  if (!zip) return null;

  const previous = localityParts.at(-2);
  return previous && US_STATE.test(previous)
    ? `${previous.toUpperCase()}, ${zip[1]}`
    : zip[1];
}
