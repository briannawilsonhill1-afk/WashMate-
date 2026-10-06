// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  renderPublicPageJsonLd,
  structuredDataSelector,
  updatePublicPageJsonLd,
} from "./structured-data";

afterEach(() => {
  document.head.querySelector(structuredDataSelector)?.remove();
});

describe("public page structured data", () => {
  it.each([
    ["landing", "https://washloop.net/", "WashMate | Local Laundry Pickup and Delivery"],
    ["privacy", "https://washloop.net/privacy", "Privacy Policy | WashMate"],
  ] as const)("links the %s page to WashMate entities", (page, url, name) => {
    const data = JSON.parse(renderPublicPageJsonLd(page));
    expect(data["@context"]).toBe("https://schema.org");
    const [organization, website, webPage] = data["@graph"];
    expect(organization).toMatchObject({
      "@type": "Organization",
      "@id": "https://washloop.net/#organization",
      name: "WashMate",
      url: "https://washloop.net/",
      logo: { url: "https://washloop.net/logo.svg" },
    });
    expect(website).toMatchObject({
      "@type": "WebSite",
      "@id": "https://washloop.net/#website",
      url: "https://washloop.net/",
      publisher: { "@id": organization["@id"] },
    });
    expect(webPage).toMatchObject({
      "@type": "WebPage",
      "@id": `${url}#webpage`,
      url,
      name,
      isPartOf: { "@id": website["@id"] },
      about: { "@id": organization["@id"] },
    });
    expect(webPage.description).toBeTruthy();
  });

  it("updates one dedicated head script on public navigation and removes it on private routes", () => {
    updatePublicPageJsonLd("landing");
    const script = document.head.querySelector<HTMLScriptElement>(structuredDataSelector);
    expect(script?.type).toBe("application/ld+json");
    expect(JSON.parse(script!.textContent!)["@graph"][2].url).toBe("https://washloop.net/");

    updatePublicPageJsonLd("privacy");
    expect(document.head.querySelectorAll(structuredDataSelector)).toHaveLength(1);
    expect(document.head.querySelector(structuredDataSelector)).toBe(script);
    expect(JSON.parse(script!.textContent!)["@graph"][2].url).toBe("https://washloop.net/privacy");

    updatePublicPageJsonLd(null);
    expect(document.head.querySelector(structuredDataSelector)).toBeNull();
  });
});