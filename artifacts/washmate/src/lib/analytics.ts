type AnalyticsData = Record<string, string | number | boolean>;

declare global {
  interface Window {
    umami?: {
      track(name: string, data?: AnalyticsData): void | Promise<unknown>;
    };
  }
}

// Only pass explicit, non-identifying dimensions. Never pass API objects,
// addresses, Stripe identifiers, error messages, or customer-written content.
export function trackEvent(name: string, data?: AnalyticsData): void {
  if (typeof window === 'undefined') return;
  try {
    const result = window.umami?.track(name, data);
    if (result) void Promise.resolve(result).catch(() => {});
  } catch {
    // Analytics must not interrupt ordering or payments.
  }
}