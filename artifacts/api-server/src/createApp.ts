import http from "http";
import type { Express } from "express";
import app from "./app";
import { setupAuth, registerAuthRoutes } from "./auth";
import { registerRoutes } from "./routes/routes";
import healthRouter from "./routes/health";
import { registerActiveUserRoutes, trackActiveUser } from "./activeUsers";

function assertClerkEnv() {
  const missing: string[] = [];
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");
  if (!process.env.CLERK_PUBLISHABLE_KEY) missing.push("CLERK_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required Clerk environment variables: ${missing.join(", ")}. ` +
        `Auth will not function without these.`,
    );
  }
}

let ready: Promise<{ app: Express; server: http.Server }> | undefined;

/**
 * Registers auth and all routes exactly once, shared by the long-running
 * server (index.ts) and the Vercel function (vercel.ts). A failed
 * initialization is not cached so the next request can retry.
 */
export function initApp(): Promise<{ app: Express; server: http.Server }> {
  ready ??= (async () => {
    assertClerkEnv();
    await setupAuth(app);
    app.use("/api", healthRouter);
    app.use("/api", trackActiveUser);
    registerAuthRoutes(app);
    registerActiveUserRoutes(app);
    const server = http.createServer(app);
    await registerRoutes(server, app);
    return { app, server };
  })().catch((err) => {
    ready = undefined;
    throw err;
  });
  return ready;
}
