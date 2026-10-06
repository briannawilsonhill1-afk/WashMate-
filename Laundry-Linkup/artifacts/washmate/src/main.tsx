import { trackEvent } from "./lib/analytics";

const root = document.getElementById("root");

if (!root) {
  throw new Error("WashMate app root is missing");
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const link = target.closest<HTMLAnchorElement>("a[data-analytics-event]");
  const eventName = link?.dataset.analyticsEvent;
  if (!eventName) return;

  trackEvent(eventName, {
    location: link.dataset.analyticsLocation ?? "unknown",
  });
});

async function mountApp() {
  const [{ default: App }, { createRoot }, { createElement }] = await Promise.all([
    import("./App"),
    import("react-dom/client"),
    import("react"),
    import("./index.css"),
  ]);

  createRoot(root!).render(createElement(App));
}

const publicRoutes = new Set(["/", "/privacy"]);
const currentPath = window.location.pathname.replace(/\/+$/, "") || "/";

if (publicRoutes.has(currentPath)) {
  // The server-rendered public document is complete and linkable on its own.
  // Delay Clerk, React Query, and authenticated route code until the browser
  // has had a chance to paint it.
  window.setTimeout(() => {
    void mountApp();
  }, 1500);
} else {
  void mountApp();
}

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
