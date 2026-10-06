import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Linking,
  Platform,
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import type {
  WebViewNavigation,
  ShouldStartLoadRequest,
} from "react-native-webview/lib/WebViewTypes";
import { useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import {
  isAllowedWebViewUrl,
  routeForNotification,
  shouldOpenExternally,
  WASHMATE_ORIGIN_WHITELIST,
  WASHMATE_URL,
} from "@/lib/webview-routing";
import { usePush } from "./_layout";

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const webViewRef = useRef<WebView>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [canGoBack, setCanGoBack] = useState(false);
  const [webViewReady, setWebViewReady] = useState(false);
  const { pushToken, pendingDeepLink, consumePendingDeepLink } = usePush();

  // JS to inject into the WebView before any page scripts run. Exposes the device
  // push token so the web app can register it against the logged-in user, and a
  // helper to navigate the SPA when a notification is tapped.
  const injectedJavaScriptBeforeContentLoaded = useMemo(() => {
    const tokenJson = JSON.stringify(pushToken ?? null);
    return `
      window.__WASHMATE_NATIVE__ = { platform: 'ios', pushToken: ${tokenJson} };
      window.__WASHMATE_PUSH_TOKEN__ = ${tokenJson};
      window.dispatchEvent(new Event('washmate:native-ready'));
      true;
    `;
  }, [pushToken]);

  // When the push token becomes available after the page has already loaded, push
  // it into the WebView so the web app can register it.
  useEffect(() => {
    if (!pushToken || !webViewRef.current) return;
    const js = `
      window.__WASHMATE_NATIVE__ = Object.assign(window.__WASHMATE_NATIVE__ || {}, {
        platform: 'ios',
        pushToken: ${JSON.stringify(pushToken)},
      });
      window.__WASHMATE_PUSH_TOKEN__ = ${JSON.stringify(pushToken)};
      window.dispatchEvent(new Event('washmate:native-ready'));
      true;
    `;
    webViewRef.current.injectJavaScript(js);
  }, [pushToken]);

  // Handle notification taps: new-order pushes open the washer dashboard;
  // customer status pushes navigate to the order detail page. On a cold start the
  // notification can arrive before the WebView is mounted/loaded, so we hold
  // the deep link in `pendingDeepLink` and only inject after `webViewReady`
  // (set on `onLoadEnd`). This guarantees the navigation script actually
  // executes instead of being silently dropped.
  useEffect(() => {
    if (!pendingDeepLink || !webViewRef.current || !webViewReady) return;
    const target = routeForNotification(pendingDeepLink);
    const js = `
      (function() {
        try {
          if (window.location.pathname !== ${JSON.stringify(target)}) {
            window.location.assign(${JSON.stringify(target)});
          }
        } catch (e) {}
        true;
      })();
    `;
    webViewRef.current.injectJavaScript(js);
    consumePendingDeepLink();
  }, [pendingDeepLink, consumePendingDeepLink, webViewReady]);

  const handleNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    setCanGoBack(nav.canGoBack);
  }, []);

  // Gate every main-frame navigation. Only WashMate first-party hosts may load
  // inside the WebView; anything else (Apple Maps deep-links, Google Maps,
  // tel:, mailto:, http:// downgrades, etc.) is handed off to the system. This
  // is the security boundary that keeps the injected push token out of reach
  // of untrusted pages.
  const onShouldStartLoadWithRequest = useCallback((req: ShouldStartLoadRequest) => {
    const url = req.url;
    if (!url) return false;
    // about:blank and the initial load handshake.
    if (isAllowedWebViewUrl(url)) return true;
    // Hand off external links (maps deep-links, etc.) to the OS. Fire and
    // forget; failure here just means the user sees nothing happen for that
    // tap, which is acceptable.
    if (shouldOpenExternally(url)) {
      Linking.openURL(url).catch(() => {});
    }
    return false;
  }, []);

  const reload = useCallback(() => {
    setHasError(false);
    setIsLoading(true);
    webViewRef.current?.reload();
  }, []);

  const goBack = useCallback(() => {
    webViewRef.current?.goBack();
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return;
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (canGoBack) {
          webViewRef.current?.goBack();
          return true;
        }
        return false;
      });
      return () => sub.remove();
    }, [canGoBack]),
  );

  return (
    <SafeAreaView
      style={[styles.safe, { backgroundColor: colors.background }]}
      edges={["top", "left", "right", "bottom"]}
    >
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />

      {!hasError && (
        <WebView
          ref={webViewRef}
          source={{ uri: WASHMATE_URL }}
          style={styles.webview}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => {
            setIsLoading(false);
            setWebViewReady(true);
          }}
          onError={() => {
            setIsLoading(false);
            setHasError(true);
          }}
          onHttpError={({ nativeEvent }) => {
            if (nativeEvent.statusCode >= 400) {
              setIsLoading(false);
              setHasError(true);
            }
          }}
          onNavigationStateChange={handleNavigationStateChange}
          onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
          injectedJavaScriptBeforeContentLoaded={injectedJavaScriptBeforeContentLoaded}
          pullToRefreshEnabled
          allowsBackForwardNavigationGestures
          startInLoadingState
          javaScriptEnabled
          domStorageEnabled
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          originWhitelist={WASHMATE_ORIGIN_WHITELIST}
          setSupportMultipleWindows={false}
          decelerationRate="normal"
        />
      )}

      {canGoBack && !hasError && !isLoading && (
        <Pressable
          onPress={goBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={12}
          style={({ pressed }) => [
            styles.backFab,
            {
              top: insets.top + 8,
              backgroundColor: colors.background,
              borderColor: colors.border,
              opacity: pressed ? 0.7 : 0.95,
            },
          ]}
        >
          <Feather name="chevron-left" size={22} color={colors.foreground} />
        </Pressable>
      )}

      {isLoading && !hasError && (
        <View style={[styles.overlay, { backgroundColor: colors.background }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}

      {hasError && (
        <View style={[styles.overlay, { backgroundColor: colors.background }]}>
          <Text style={[styles.errorTitle, { color: colors.foreground }]}>
            Couldn't load WashMate
          </Text>
          <Text style={[styles.errorBody, { color: colors.mutedForeground }]}>
            Check your connection and try again.
          </Text>
          <Pressable
            onPress={reload}
            style={({ pressed }) => [
              styles.retryButton,
              {
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Try again"
          >
            <Text style={[styles.retryText, { color: colors.primaryForeground }]}>
              Try again
            </Text>
          </Pressable>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  webview: { flex: 1 },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 8,
    textAlign: "center",
  },
  errorBody: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
  },
  retryButton: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 10,
  },
  retryText: { fontSize: 16, fontWeight: "600" },
  backFab: {
    position: "absolute",
    left: 12,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
});
