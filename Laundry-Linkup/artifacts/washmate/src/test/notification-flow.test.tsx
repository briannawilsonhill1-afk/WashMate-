import { act, cleanup, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "@/pages/Settings";
import { usePushRegistration } from "@/hooks/use-push-registration";
import { useAuth } from "@/hooks/use-auth";
import {
  getCurrentDeviceToken,
  isPushEnabled,
  registerCurrentToken,
  setPushEnabled,
  unregisterCurrentToken,
} from "@/lib/device-token";

// Keep the application hooks, settings switch, and token flow real. Only the
// identity/query boundaries, toast output, and HTTP transport are replaced.
const session = vi.hoisted(() => ({
  user: { id: "", role: "customer" },
  signedIn: true,
  signOut: vi.fn(),
  toast: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: session.signedIn }),
  useClerk: () => ({ signOut: session.signOut }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: session.user, isLoading: false }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: session.toast }) }));

const http = vi.fn<typeof fetch>();
let sequence = 0;
const ok = () => new Response(null, { status: 204 });
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
function nativeReady() {
  act(() => { window.dispatchEvent(new Event("washmate:native-ready")); });
}
function App() {
  usePushRegistration();
  return <Settings />;
}
const toggle = () => screen.getByRole("switch", { name: "Push notifications" });
async function expectSwitch(checked: boolean) {
  await waitFor(() => {
    expect(toggle().getAttribute("aria-checked")).toBe(String(checked));
    expect(toggle().hasAttribute("disabled")).toBe(false);
  });
}
function expectRequest(index: number, method: string) {
  expect(http).toHaveBeenNthCalledWith(index, "/api/device-tokens", {
    method,
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(method === "POST"
      ? { token: getCurrentDeviceToken(), platform: "ios" }
      : { token: getCurrentDeviceToken() }),
  });
}

beforeEach(() => {
  session.user = { id: `notification-user-${++sequence}`, role: "customer" };
  session.signedIn = true;
  window.localStorage.clear();
  window.__WASHMATE_NATIVE__ = { platform: "ios", pushToken: "ExponentPushToken[test]" };
  delete window.__WASHMATE_PUSH_TOKEN__;
  http.mockReset().mockImplementation(async () => ok());
  vi.stubGlobal("fetch", http);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__WASHMATE_NATIVE__;
  delete window.__WASHMATE_PUSH_TOKEN__;
});

describe("notification settings and automatic registration", () => {
  it("deletes on opt-out, blocks native-ready and remount registration, and re-registers on opt-in", async () => {
    const user = userEvent.setup();
    const view = render(<App />);
    await waitFor(() => expect(http).toHaveBeenCalledTimes(1));
    expectRequest(1, "POST");
    await user.click(toggle());
    await expectSwitch(false);
    expectRequest(2, "DELETE");
    expect(isPushEnabled(session.user.id)).toBe(false);
    nativeReady();
    view.unmount();
    render(<App />);
    nativeReady();
    expect(http).toHaveBeenCalledTimes(2);
    await user.click(toggle());
    await expectSwitch(true);
    expectRequest(3, "POST");
    expect(isPushEnabled(session.user.id)).toBe(true);
  });

  it("waits for in-flight automatic registration before opt-out DELETE", async () => {
    const pending = deferredResponse();
    http.mockReturnValueOnce(pending.promise);
    render(<App />);
    await userEvent.setup().click(toggle());
    expect(isPushEnabled(session.user.id)).toBe(false);
    expect(toggle().hasAttribute("disabled")).toBe(true);
    nativeReady();
    expect(http).toHaveBeenCalledTimes(1);
    await act(async () => { pending.resolve(ok()); });
    await expectSwitch(false);
    expectRequest(2, "DELETE");
    nativeReady();
    expect(http).toHaveBeenCalledTimes(2);
  });

  it("disables the switch without a native token and registers when one arrives", async () => {
    delete window.__WASHMATE_NATIVE__;
    render(<App />);
    expect(toggle().hasAttribute("disabled")).toBe(true);
    expect(screen.getByTestId("text-notifications-unavailable")).toBeTruthy();
    await userEvent.setup().click(toggle());
    expect(http).not.toHaveBeenCalled();
    window.__WASHMATE_PUSH_TOKEN__ = "ExponentPushToken[late]";
    nativeReady();
    await expectSwitch(true);
    expectRequest(1, "POST");
  });

  it.each(["POST", "DELETE"])("rolls back the setting and allows retry after a failed %s", async (method) => {
    const initial = method === "DELETE";
    setPushEnabled(session.user.id, initial);
    render(<Settings />);
    http.mockRejectedValueOnce(new TypeError("Network unavailable"));
    await userEvent.setup().click(toggle());
    await expectSwitch(initial);
    expect(isPushEnabled(session.user.id)).toBe(initial);
    expect(session.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: "destructive", title: "Could not update notifications",
    }));
    await userEvent.setup().click(toggle());
    await expectSwitch(!initial);
    expectRequest(1, method);
    expectRequest(2, method);
  });

  it("keeps the switch usable and reports when opt-out cannot be persisted", async () => {
    render(<Settings />);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Quota exceeded", "QuotaExceededError");
    });

    await userEvent.setup().click(toggle());

    await expectSwitch(true);
    expect(http).not.toHaveBeenCalled();
    expect(session.toast).toHaveBeenCalledWith(expect.objectContaining({
      variant: "destructive",
      title: "Notifications preference not saved",
      description: expect.stringContaining("storage"),
    }));
    expect(isPushEnabled(session.user.id)).toBe(true);
    expect(setItem).toHaveBeenCalled();

    setItem.mockRestore();
    await userEvent.setup().click(toggle());
    await expectSwitch(false);
    expectRequest(1, "DELETE");
  });

  it("does not automatically register while signed out and removes its event listener on unmount", () => {
    session.signedIn = false;
    const view = renderHook(() => usePushRegistration());
    nativeReady();
    expect(http).not.toHaveBeenCalled();
    session.signedIn = true;
    view.rerender();
    expect(http).toHaveBeenCalledTimes(1);
    view.unmount();
    window.__WASHMATE_NATIVE__!.pushToken = "another-token";
    nativeReady();
    expect(http).toHaveBeenCalledTimes(1);
  });
});

describe("logout cleanup", () => {
  it.each([204, 500, "network"] as const)("waits for removal before Clerk sign-out even with result %s", async (result) => {
    const pending = deferredResponse();
    http.mockImplementationOnce(async () => {
      await pending.promise;
      if (result === "network") throw new TypeError("Offline");
      return new Response(null, { status: result });
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { result: auth } = renderHook(() => useAuth());
    act(() => auth.current.logout());
    await waitFor(() => expectRequest(1, "DELETE"));
    expect(session.signOut).not.toHaveBeenCalled();
    await act(async () => { pending.resolve(ok()); });
    await waitFor(() => expect(session.signOut).toHaveBeenCalledTimes(1));
  });

  it("ends the session without a network request when the native token is unavailable", async () => {
    delete window.__WASHMATE_NATIVE__;
    const { result } = renderHook(() => useAuth());
    await act(async () => result.current.logout());
    expect(http).not.toHaveBeenCalled();
    expect(session.signOut).toHaveBeenCalledTimes(1);
  });
});

describe("device-token failure and deduplication contract", () => {
  it("does not request registration or deletion when there is no token", async () => {
    delete window.__WASHMATE_NATIVE__;
    expect(await registerCurrentToken(session.user.id)).toBe(false);
    expect(await unregisterCurrentToken(session.user.id)).toBe(true);
    expect(http).not.toHaveBeenCalled();
  });

  it("deduplicates pending and successful registration requests", async () => {
    const pending = deferredResponse();
    http.mockReturnValueOnce(pending.promise);
    const first = registerCurrentToken(session.user.id);
    const second = registerCurrentToken(session.user.id);
    expect(http).toHaveBeenCalledTimes(1);
    pending.resolve(ok());
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(await registerCurrentToken(session.user.id)).toBe(true);
    expect(http).toHaveBeenCalledTimes(1);
  });

  it.each(["http", "network"])("does not cache a failed %s registration and permits retry", async (failure) => {
    if (failure === "http") http.mockResolvedValueOnce(new Response(null, { status: 503 }));
    else http.mockRejectedValueOnce(new TypeError("Offline"));
    expect(await registerCurrentToken(session.user.id)).toBe(false);
    expect(await registerCurrentToken(session.user.id)).toBe(true);
    expect(http).toHaveBeenCalledTimes(2);
  });
});