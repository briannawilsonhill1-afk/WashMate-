/**
 * Versioned standalone FCRA disclosure text.
 *
 * ---------------------------------------------------------------------------
 * TEMPLATE — NOT LEGAL ADVICE. This text must be CUSTOMIZED with WashMate's
 * real business details and REVIEWED BY EMPLOYMENT COUNSEL before any live
 * screening. Federal law requires this disclosure to be clear, conspicuous,
 * and in a standalone document containing ONLY the disclosure — it must not
 * be bundled with other consents, waivers, or terms. State laws may require
 * additional or different language.
 * ---------------------------------------------------------------------------
 */

import { FCRA_DISCLOSURE_VERSION } from "./fcra";

export interface FcraDisclosureDetails {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  craName: string;
}

/**
 * Render the standalone disclosure. It contains ONLY the background-check
 * disclosure — no waivers, no terms, no other consents — so it can be shown
 * on its own screen as federal guidance describes.
 */
export function renderFcraDisclosureText(details: FcraDisclosureDetails): string {
  return `DISCLOSURE REGARDING BACKGROUND INVESTIGATION
(Version ${FCRA_DISCLOSURE_VERSION})

${details.businessName} ("the Company"), ${details.businessAddress}, ${details.businessPhone}, may obtain a consumer report about you from a consumer reporting agency for the purpose of evaluating your eligibility to provide services as an independent washer through the Company's platform.

The consumer reporting agency the Company uses is ${details.craName}. The report may include information about your character, general reputation, personal characteristics, and mode of living, which may be obtained through personal interviews, as well as criminal history and other public records, subject to applicable law.

You have the right, upon written request made within a reasonable period of time, to request disclosure of the nature and scope of any investigative consumer report. If you would like a copy of any report obtained about you, or if you have questions about this disclosure, contact the Company at the address or phone number above.

This disclosure is provided on its own, separate from any other documents or consents.

---
TEMPLATE — CUSTOMIZE with your business details and have employment counsel review before use. This is not legal advice.`;
}

export { FCRA_DISCLOSURE_VERSION };
