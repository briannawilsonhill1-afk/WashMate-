const DEFAULT_WASHMATE_URL = "https://washloop.net";

/**
 * Resolve the canonical first-party site URL embedded in an Expo build.
 * Invalid values fail the build/app startup rather than silently weakening
 * the WebView's navigation boundary.
 */
export function resolveWashMateUrl(
  configuredUrl = process.env.EXPO_PUBLIC_WASHMATE_URL,
) {
  const candidate = configuredUrl || DEFAULT_WASHMATE_URL;
  let parsed;

  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("EXPO_PUBLIC_WASHMATE_URL must be a valid absolute URL");
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(
      "EXPO_PUBLIC_WASHMATE_URL must be an HTTPS origin without credentials, port, path, query, or fragment",
    );
  }

  return parsed.origin;
}

export const WASHMATE_URL = resolveWashMateUrl();
export const WASHMATE_HOST = new URL(WASHMATE_URL).hostname;
export const WASHMATE_ORIGIN_WHITELIST = [WASHMATE_URL];

export function isAllowedWebViewUrl(url, firstPartyHost = WASHMATE_HOST) {
  if (url === "about:blank") return true;

  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === firstPartyHost;
  } catch {
    return false;
  }
}

export function shouldOpenExternally(url, firstPartyHost = WASHMATE_HOST) {
  if (isAllowedWebViewUrl(url, firstPartyHost)) return false;

  try {
    const parsed = new URL(url);
    return ["https:", "http:", "mailto:", "tel:", "maps:"].includes(
      parsed.protocol,
    );
  } catch {
    return false;
  }
}

export function routeForNotification(deepLink) {
  if (deepLink.type === "new_order") return "/washer";
  if (typeof deepLink.orderId === "number") return `/orders/${deepLink.orderId}`;
  return "/customer";
}