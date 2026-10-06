import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

// `easConfig.projectId` is provided at runtime by EAS-built apps but is not in
// expo-constants' public type. Read it via a typed local interface to avoid
// reaching for `any`.
interface ConstantsWithEas {
  easConfig?: { projectId?: string };
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (!Device.isDevice) {
    // Push notifications only work on physical devices.
    return null;
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }
  if (status !== "granted") return null;

  try {
    const easRuntime = Constants as unknown as ConstantsWithEas;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? easRuntime.easConfig?.projectId;
    const tokenResp = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return tokenResp.data;
  } catch {
    // No EAS project ID configured — push token can't be issued. Fail soft so the app
    // still runs in dev. To enable push, configure `extra.eas.projectId` in app.json.
    return null;
  }
}
