export interface NotificationDeepLink {
  orderId?: number;
  type?: string;
}

export function resolveWashMateUrl(configuredUrl?: string): string;
export const WASHMATE_URL: string;
export const WASHMATE_HOST: string;
export const WASHMATE_ORIGIN_WHITELIST: string[];
export function isAllowedWebViewUrl(
  url: string,
  firstPartyHost?: string,
): boolean;
export function shouldOpenExternally(
  url: string,
  firstPartyHost?: string,
): boolean;
export function routeForNotification(deepLink: NotificationDeepLink): string;