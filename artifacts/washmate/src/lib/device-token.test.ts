import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCurrentDeviceToken,
  isPushEnabled,
  registerCurrentToken,
  setPushEnabled,
  subscribeToNativeToken,
  unregisterCurrentToken,
} from "./device-token";

function createLocalStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

beforeEach(() => {
  const target = new EventTarget() as EventTarget & {
    __WASHMATE_NATIVE__?: { platform?: string; pushToken?: string | null };
    __WASHMATE_PUSH_TOKEN__?: string | null;
    localStorage: ReturnType<typeof createLocalStorage>;
  };
  target.__WASHMATE_NATIVE__ = {
    platform: "ios",
    pushToken: "ExpoPushToken[test-device]",
  };
  target.localStorage = createLocalStorage();
  vi.stubGlobal("window", target);
  vi.restoreAllMocks();
});

describe("device token preference coordination", () => {
  it("defaults to enabled and reports failure when browser storage is unavailable", () => {
    const storage = window.localStorage;
    vi.spyOn(storage, "getItem").mockImplementation(() => {
      throw new DOMException("Storage access denied", "SecurityError");
    });
    vi.spyOn(storage, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    expect(isPushEnabled("user-storage")).toBe(true);
    expect(setPushEnabled("user-storage", false)).toBe(false);
  });

  it("waits for an in-flight registration before unregistering", async () => {
    let finishRegistration: ((value: { ok: boolean }) => void) | undefined;
    const registrationResponse = new Promise<{ ok: boolean }>((resolve) => {
      finishRegistration = resolve;
    });
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => registrationResponse)
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const registration = registerCurrentToken("user-race");
    setPushEnabled("user-race", false);
    const unregistration = unregisterCurrentToken("user-race");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });

    finishRegistration?.({ ok: true });
    await registration;
    await unregistration;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "DELETE" });
  });

  it("notifies subscribers when the native shell injects a token late", () => {
    window.__WASHMATE_NATIVE__ = { platform: "ios", pushToken: null };
    const listener = vi.fn();
    const unsubscribe = subscribeToNativeToken(listener);

    window.__WASHMATE_NATIVE__.pushToken = "ExpoPushToken[late-device]";
    window.dispatchEvent(new Event("washmate:native-ready"));

    expect(listener).toHaveBeenCalledWith("ExpoPushToken[late-device]");
    expect(getCurrentDeviceToken()).toBe("ExpoPushToken[late-device]");
    unsubscribe();
  });
});