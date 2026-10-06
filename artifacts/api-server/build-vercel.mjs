// Produces a Vercel Build Output API (v3) directory containing the washmate
// static frontend plus this Express API as a single Node.js function that
// serves every /api/* request.
// https://vercel.com/docs/build-output-api/v3
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { cp, mkdir, rm, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// esbuild-plugin-pino uses `require` to resolve dependencies.
globalThis.require = createRequire(import.meta.url);

const artifactDir = dirname(fileURLToPath(import.meta.url));
const washmateDir = resolve(artifactDir, "../washmate");
const outputDir = resolve(washmateDir, ".vercel/output");
const staticSource = resolve(washmateDir, "dist/public");
const functionDir = join(outputDir, "functions/api.func");

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=63072000",
  "X-Frame-Options": "SAMEORIGIN",
};

async function main() {
  try {
    await access(join(staticSource, "index.html"));
  } catch {
    throw new Error(
      `Frontend build not found at ${staticSource}. Build washmate before running build:vercel.`,
    );
  }

  await rm(outputDir, { recursive: true, force: true });
  await mkdir(functionDir, { recursive: true });
  await cp(staticSource, join(outputDir, "static"), { recursive: true });

  await esbuild({
    entryPoints: [resolve(artifactDir, "src/vercel.ts")],
    platform: "node",
    bundle: true,
    format: "esm",
    outdir: functionDir,
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Native addons and the Replit-only storage SDK cannot be bundled. The
    // storage SDK is imported lazily, so its absence only affects evidence
    // uploads/downloads rather than the whole API.
    external: ["*.node", "pg-native", "@replit/object-storage"],
    sourcemap: "linked",
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  });

  await writeFile(
    join(functionDir, ".vc-config.json"),
    JSON.stringify(
      {
        runtime: "nodejs22.x",
        handler: "vercel.mjs",
        launcherType: "Nodejs",
        shouldAddHelpers: false,
        supportsResponseStreaming: true,
        maxDuration: 60,
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(outputDir, "config.json"),
    JSON.stringify(
      {
        version: 3,
        routes: [
          { src: "/(.*)", headers: securityHeaders, continue: true },
          { handle: "filesystem" },
          // API requests go to the function and never fall through to the
          // SPA, so a missing endpoint is a real 404 from Express.
          { src: "^/api(?:/.*)?$", dest: "/api" },
          { src: "/(.*)", dest: "/index.html" },
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
