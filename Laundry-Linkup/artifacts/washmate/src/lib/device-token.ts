declare global {
  interface Window {
    __WASHMATE_PUSH_TOKEN__?: string | null;
    __WASHMATE_NATIVE__?: { platform?: string; pushToken?: string | null };
  }
}

const REGISTERED_TOKENS = new Set<string>();
const REGISTRATION_REQUESTS = new Map<string, Promise<boolean>>();
const NOTIFICATION_PREFERENCE_PREFIX = "washmate:push-enabled:";

export function getCurrentDeviceToken(): string | null {
  return window.__WASHMATE_NATIVE__?.pushToken ?? window.__WASHMATE_PUSH_TOKEN__ ?? null;
}

export function getCurrentDevicePlatform(): string {
  return window.__WASHMATE_NATIVE__?.platform ?? "ios";
}

export function subscribeToNativeToken(listener: (token: string | null) => void): () => void {
  const handleNativeReady = () => listener(getCurrentDeviceToken());
  window.addEventListener("washmate:native-ready", handleNativeReady);
  return () => window.removeEventListener("washmate:native-ready", handleNativeReady);
}

export function isPushEnabled(userId: string): boolean {
  try {
    return window.localStorage.getItem(`${NOTIFICATION_PREFERENCE_PREFIX}${userId}`) !== "false";
  } catch {
    // Push notifications remain enabled by default when the browser cannot
    // read storage. A failed opt-out is handled by setPushEnabled instead of
    // silently allowing the settings UI to report success.
    return true;
  }
}

export function setPushEnabled(userId: string, enabled: boolean): boolean {
  try {
    window.localStorage.setItem(
      `${NOTIFICATION_PREFERENCE_PREFIX}${userId}`,
      enabled ? "true" : "false",
    );
    return true;
  } catch {
    // Storage can be blocked or full (for example, in private browsing).
    // Let the caller keep the previous UI state and explain how to recover.
    return false;
  }
}

export async function registerCurrentToken(userId: string): Promise<boolean> {
  const token = getCurrentDeviceToken();
  if (!token || !isPushEnabled(userId)) return false;

  const key = `${userId}:${token}`;
  if (REGISTERED_TOKENS.has(key)) return true;
  const pending = REGISTRATION_REQUESTS.get(key);
  if (pending) return pending;

  const request = (async () => {
    try {
      const res = await fetch("/api/device-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ token, platform: getCurrentDevicePlatform() }),
      });
      if (res.ok) REGISTERED_TOKENS.add(key);
      return res.ok;
    } catch {
      return false;
    } finally {
      REGISTRATION_REQUESTS.delete(key);
    }
  })();

  REGISTRATION_REQUESTS.set(key, request);
  return request;
}

/**
 * Reads the Expo push token injected by the native iOS shell and sends a
 * DELETE to the API to remove that token from the authenticated user's account.
 *
 * Authentication is session-cookie based — no userId argument needed.
 * Best-effort: logs a warning on failure but never throws so logout always completes.
 */
export async function unregisterCurrentToken(userId?: string): Promise<boolean> {
  const token = getCurrentDeviceToken();
  if (!token) return true;
  const key = userId ? `${userId}:${token}` : null;

  // If auto-registration is still in flight, let it finish before deleting.
  // This guarantees opt-out's DELETE is the final server operation.
  if (key) await REGISTRATION_REQUESTS.get(key);

  try {
    const res = await fetch("/api/device-tokens", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      console.warn("[WashMate] push token unregister failed:", res.status);
      return false;
    }
    if (key) REGISTERED_TOKENS.delete(key);
    return true;
  } catch {
    // Network error or app termination: the stale binding is resolved server-side.
    // When the next user registers the same device token via /api/device-tokens,
    // the server atomically rebinds the token to their account (ON CONFLICT DO UPDATE),
    // so the previous owner stops receiving pushes without requiring this DELETE to succeed.
    return false;
  }
}
