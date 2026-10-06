import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import {
  renderStaticLandingPage,
  renderStaticPrivacyPage,
} from "./src/seo/static-pages";
import { renderPublicPageJsonLd } from "./src/seo/structured-data";

const isBuild = process.argv.includes("build");
const rawPort = process.env.PORT;

if (!rawPort && !isBuild) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = rawPort ? Number(rawPort) : 5173;

if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath && !isBuild) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

function prerenderPublicPages(): Plugin {
  return {
    name: "washmate-prerender-public-pages",
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        const [pathname, query] = (request.url ?? "").split("?", 2);
        if (pathname === "/privacy" || pathname === "/privacy/") {
          request.url = `/privacy/index.html${query ? `?${query}` : ""}`;
        }
        next();
      });
    },
    transformIndexHtml(html, context) {
      // In development Vite serves index.html for SPA fallbacks; use the
      // original URL so account pages do not inherit the landing schema.
      const requestedPath = (context.originalUrl ?? context.path).split("?")[0];
      const isPrivacy =
        requestedPath === "/privacy" || requestedPath === "/privacy/" ||
        requestedPath === "/privacy/index.html";
      const page = isPrivacy ? "privacy" : "landing";
      const isLanding = requestedPath === "/" || requestedPath === "/index.html";
      const markup = isPrivacy
        ? renderStaticPrivacyPage()
        : renderStaticLandingPage();

      return {
        html: html.replace(
          '<div id="root"></div>',
          `<div id="root">${markup}</div>`,
        ),
        tags: isPrivacy || isLanding ? [
          {
            tag: "script",
            attrs: { type: "application/ld+json", "data-washmate-jsonld": "" },
            children: renderPublicPageJsonLd(page),
            injectTo: "head",
          },
        ] : [],
      };
    },
  };
}

export default defineConfig({
  base: basePath ?? "/",
  plugins: [
    react(),
    prerenderPublicPages(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  css: {
    postcss: {
      plugins: [
        (await import("autoprefixer")).default(),
        (await import("tailwindcss")).default(),
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        privacy: path.resolve(import.meta.dirname, "privacy/index.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Match by `/<pkg>/` to avoid catching unrelated packages whose
          // names start with the same prefix (e.g. `react-*` vs `react`).
          if (id.includes("/@clerk/")) return "vendor-clerk";
          if (id.includes("/@tanstack/")) return "vendor-query";
          if (id.includes("/@radix-ui/")) return "vendor-radix";
          if (
            id.includes("/recharts/") ||
            id.includes("/d3-") ||
            id.includes("/victory-vendor/")
          ) {
            return "vendor-charts";
          }
          if (id.includes("/framer-motion/")) return "vendor-motion";
          if (
            id.includes("/react-day-picker/") ||
            id.includes("/date-fns/")
          ) {
            return "vendor-date";
          }
          if (
            id.includes("/react-hook-form/") ||
            id.includes("/@hookform/")
          ) {
            return "vendor-forms";
          }
          if (
            id.includes("/lucide-react/") ||
            id.includes("/react-icons/")
          ) {
            return "vendor-icons";
          }
          if (
            id.includes("/react/") ||
            id.includes("/react-dom/") ||
            id.includes("/scheduler/")
          ) {
            return "vendor-react";
          }
          // Let Rollup keep route-specific dependencies with lazy routes.
          return undefined;
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
