/**
 * Versioned adverse-action notice TEMPLATES.
 *
 * ---------------------------------------------------------------------------
 * TEMPLATES — NOT LEGAL ADVICE. Customize every bracketed field with real
 * business and consumer-reporting-agency details and have employment counsel
 * review before use. These templates implement the *structure* federal
 * guidance describes (pre-adverse notice with report copy + Summary of
 * Rights + time to respond; final notice with agency contact info, a
 * statement that the agency did not make the decision, and dispute rights).
 * They do not reproduce the CFPB "Summary of Your Rights" document — link to
 * the official CFPB source instead: https://www.consumerfinance.gov/learnmore
 * ---------------------------------------------------------------------------
 */

import { FCRA_NOTICE_VERSION } from "./fcra";

export const CFPB_RIGHTS_URL = "https://www.consumerfinance.gov/learnmore";

export interface AdverseNoticeDetails {
  businessName: string;
  businessAddress: string;
  businessPhone: string;
  craName: string;
  craAddress: string;
  craPhone: string;
  candidateName: string;
  /** Date the notice is sent, e.g. "October 16, 2026". */
  noticeDate: string;
  /** For the pre-adverse notice: when the response window closes, e.g. "October 23, 2026". */
  responseDeadline?: string;
}

const TEMPLATE_FOOTER = `---
TEMPLATE (version ${FCRA_NOTICE_VERSION}) — CUSTOMIZE all bracketed fields and have employment counsel review before use. This is not legal advice.`;

/** Pre-adverse action notice: sent BEFORE any final decision, with report copy + rights. */
export function renderPreAdverseNotice(details: AdverseNoticeDetails): string {
  return `NOTICE OF PRE-ADVERSE ACTION — BACKGROUND SCREENING
Date: ${details.noticeDate}

Dear ${details.candidateName},

${details.businessName} ("the Company"), ${details.businessAddress}, ${details.businessPhone}, is considering not engaging you as an independent washer based in whole or in part on information in a consumer report about you.

Before any final decision is made, federal law gives you the right to review that information:

1. A COPY OF THE CONSUMER REPORT obtained about you is enclosed with this notice.
2. A SUMMARY OF YOUR RIGHTS UNDER THE FAIR CREDIT REPORTING ACT is available from the Consumer Financial Protection Bureau at ${CFPB_RIGHTS_URL}.

You have until ${details.responseDeadline ?? "[RESPONSE DEADLINE — CUSTOMIZE]"} to contact us if you believe any information in the report is inaccurate or incomplete, or if you would like to provide additional context. You may also dispute the accuracy of the report directly with the consumer reporting agency:

${details.craName}
${details.craAddress}
${details.craPhone}

No final decision has been made at this time.

Sincerely,
${details.businessName}

${TEMPLATE_FOOTER}`;
}

/** Final adverse action notice: sent AFTER the waiting period if the decision stands. */
export function renderAdverseActionNotice(details: AdverseNoticeDetails): string {
  return `NOTICE OF ADVERSE ACTION — BACKGROUND SCREENING
Date: ${details.noticeDate}

Dear ${details.candidateName},

${details.businessName} ("the Company"), ${details.businessAddress}, ${details.businessPhone}, has decided not to engage you as an independent washer. This decision was based in whole or in part on information in a consumer report about you.

The consumer reporting agency that furnished the report is:

${details.craName}
${details.craAddress}
${details.craPhone}

The consumer reporting agency did NOT make this decision and cannot explain why it was made. You have the right to dispute the accuracy or completeness of any information in the report directly with the agency at the contact information above.

You have the right to obtain a free copy of the report if you request it from the agency within 60 days of this notice.

A summary of your rights under the Fair Credit Reporting Act is available from the Consumer Financial Protection Bureau at ${CFPB_RIGHTS_URL}.

Sincerely,
${details.businessName}

${TEMPLATE_FOOTER}`;
}

export { FCRA_NOTICE_VERSION };
