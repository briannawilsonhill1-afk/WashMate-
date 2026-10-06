import { landingContent, privacyContent } from "../content/public-pages";

export const structuredDataSelector = 'script[data-washmate-jsonld]';

const canonicalOrigin = "https://washloop.net";

export function renderPublicPageJsonLd(page: "landing" | "privacy"): string {
  const organizationId = `${canonicalOrigin}/#organization`;
  const websiteId = `${canonicalOrigin}/#website`;
  const isPrivacy = page === "privacy";
  const pageUrl = isPrivacy ? `${canonicalOrigin}/privacy` : `${canonicalOrigin}/`;
  const pageName = isPrivacy
    ? `${privacyContent.title} | WashMate`
    : "WashMate | Local Laundry Pickup and Delivery";
  const pageDescription = isPrivacy
    ? privacyContent.subtitle
    : landingContent.description;

  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organizationId,
        name: "WashMate",
        url: `${canonicalOrigin}/`,
        logo: {
          "@type": "ImageObject",
          url: `${canonicalOrigin}/logo.svg`,
        },
      },
      {
        "@type": "WebSite",
        "@id": websiteId,
        url: `${canonicalOrigin}/`,
        name: "WashMate",
        publisher: { "@id": organizationId },
        inLanguage: "en-US",
      },
      {
        "@type": "WebPage",
        "@id": `${pageUrl}#webpage`,
        url: pageUrl,
        name: pageName,
        description: pageDescription,
        isPartOf: { "@id": websiteId },
        about: { "@id": organizationId },
        inLanguage: "en-US",
      },
    ],
  }).replaceAll("<", "\\u003c");
}

export function updatePublicPageJsonLd(page: "landing" | "privacy" | null): void {
  const existing = document.head.querySelector<HTMLScriptElement>(structuredDataSelector);
  if (!page) {
    existing?.remove();
    return;
  }

  const script = existing ?? document.createElement("script");
  script.type = "application/ld+json";
  script.dataset.washmateJsonld = "";
  script.textContent = renderPublicPageJsonLd(page);
  if (!existing) document.head.append(script);
}