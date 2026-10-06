import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { registerCurrentToken } from "@/lib/device-token";

/**
 * When running inside the WashMate iOS WebView, the native shell injects an Expo
 * push token onto `window.__WASHMATE_PUSH_TOKEN__`. Once the user is logged in we
 * forward that token to the API so the server can deliver order-status pushes.
 *
 * No-op in a regular browser (no token is ever injected).
 */
export function usePushRegistration(): void {
  const { isAuthenticated, user } = useAuth();
  const userId = user?.id;

  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    const tryRegister = () => void registerCurrentToken(userId);

    tryRegister();
    const handler = () => tryRegister();
    window.addEventListener("washmate:native-ready", handler);
    return () => window.removeEventListener("washmate:native-ready", handler);
  }, [isAuthenticated, userId]);
}
