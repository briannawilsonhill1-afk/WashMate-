import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FcraDisclosureModal from "@/components/FcraDisclosureModal";
import { api } from "@/lib/api";

// Keep the modal real; replace the query/toast boundaries and HTTP transport.
vi.mock("@tanstack/react-query", () => ({
  useMutation: (opts: {
    mutationFn: () => Promise<unknown>;
    onSuccess: () => void;
    onError: (e: Error) => void;
  }) => ({
    mutate: async () => {
      try {
        await opts.mutationFn();
        opts.onSuccess();
      } catch (e: any) {
        opts.onError(e);
      }
    },
    isPending: false,
  }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const DISCLOSURE_TEXT = "DISCLOSURE REGARDING BACKGROUND INVESTIGATION (Version 1.0)";

function stubFetch() {
  return vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    if (url === api.washerProfile.fcraDisclosure.path) {
      return { ok: true, json: async () => ({ version: "1.0", text: DISCLOSURE_TEXT }) };
    }
    if (url === api.washerProfile.fcraAuthorize.path && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ authorized: true, version: "1.0", authorizedAt: new Date().toISOString() }),
      };
    }
    throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url}`);
  });
}

describe("FcraDisclosureModal", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows ONLY the disclosure on its own screen — nothing bundled with it", async () => {
    render(<FcraDisclosureModal open onClose={vi.fn()} onAuthorized={vi.fn()} />);

    await waitFor(() => expect(screen.getByTestId("fcra-disclosure-text")).toBeTruthy());
    const modal = screen.getByTestId("fcra-disclosure-modal");
    const text = modal.textContent?.toLowerCase() ?? "";
    // The disclosure step must not bundle any other consent, terms, or waivers.
    expect(text).not.toContain("terms of service");
    expect(text).not.toContain("waiver");
    expect(text).not.toContain("marketing");
    // The authorization checkbox lives on a separate step, not this screen.
    expect(screen.queryByTestId("checkbox-fcra-authorize")).toBeNull();
  });

  it("keeps authorization a separate, explicit act", async () => {
    const user = userEvent.setup();
    const onAuthorized = vi.fn();
    render(<FcraDisclosureModal open onClose={vi.fn()} onAuthorized={onAuthorized} />);
    await waitFor(() => expect(screen.getByTestId("button-fcra-continue")).toBeTruthy());

    await user.click(screen.getByTestId("button-fcra-continue"));

    const authorizeButton = screen.getByTestId("button-fcra-authorize");
    // A single checkbox, unchecked by default — the button stays disabled.
    expect((authorizeButton as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByTestId("checkbox-fcra-authorize"));
    expect((authorizeButton as HTMLButtonElement).disabled).toBe(false);

    await user.click(authorizeButton);
    await waitFor(() => expect(onAuthorized).toHaveBeenCalledTimes(1));

    // The POST carried the explicit confirmation payload.
    const fetchMock = vi.mocked(fetch);
    const postCall = fetchMock.mock.calls.find(([url]) => url === api.washerProfile.fcraAuthorize.path);
    expect(postCall).toBeTruthy();
    expect(JSON.parse((postCall![1] as { body: string }).body)).toEqual({ authorized: true });
  });

  it("warns when the disclosure changed since the last authorization", async () => {
    render(
      <FcraDisclosureModal open onClose={vi.fn()} onAuthorized={vi.fn()} authorizedVersion="0.9" />,
    );
    await waitFor(() => expect(screen.getByTestId("fcra-version-stale-notice")).toBeTruthy());
    expect(screen.getByTestId("fcra-version-stale-notice").textContent).toContain("0.9");
  });
});
