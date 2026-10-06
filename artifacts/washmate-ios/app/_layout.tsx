import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { registerForPushNotificationsAsync } from "@/lib/push";

SplashScreen.preventAutoHideAsync();

interface PushContextValue {
  pushToken: string | null;
  pendingDeepLink: { orderId?: number; type?: string } | null;
  consumePendingDeepLink: () => void;
}

const PushContext = createContext<PushContextValue>({
  pushToken: null,
  pendingDeepLink: null,
  consumePendingDeepLink: () => {},
});

export function usePush() {
  return useContext(PushContext);
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  const [pushToken, setPushToken] = useState<string | null>(null);
  const [pendingDeepLink, setPendingDeepLink] = useState<
    { orderId?: number; type?: string } | null
  >(null);
  const responseListener = useRef<Notifications.EventSubscription | null>(null);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    let cancelled = false;
    registerForPushNotificationsAsync()
      .then((token) => {
        if (!cancelled) setPushToken(token);
      })
      .catch(() => {});

    // If the app was launched by tapping a notification, capture that.
    Notifications.getLastNotificationResponseAsync()
      .then((resp) => {
        if (!resp || cancelled) return;
        const data = resp.notification.request.content.data as
          | { orderId?: number; type?: string }
          | undefined;
        if (data) setPendingDeepLink(data);
      })
      .catch(() => {});

    // Subscribe for taps while the app is running.
    responseListener.current = Notifications.addNotificationResponseReceivedListener(
      (resp) => {
        const data = resp.notification.request.content.data as
          | { orderId?: number; type?: string }
          | undefined;
        if (data) setPendingDeepLink(data);
      },
    );

    return () => {
      cancelled = true;
      responseListener.current?.remove();
      responseListener.current = null;
    };
  }, []);

  const ctx = useMemo<PushContextValue>(
    () => ({
      pushToken,
      pendingDeepLink,
      consumePendingDeepLink: () => setPendingDeepLink(null),
    }),
    [pushToken, pendingDeepLink],
  );

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <GestureHandlerRootView style={{ flex: 1 }}>
          <PushContext.Provider value={ctx}>
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="index" />
            </Stack>
          </PushContext.Provider>
        </GestureHandlerRootView>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
