import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupAuth, registerAuthRoutes } from "./auth";
import { registerRoutes } from "./routes/routes";
import healthRouter from "./routes/health";
import { registerActiveUserRoutes, trackActiveUser } from "./activeUsers";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

function assertClerkEnv() {
  const missing: string[] = [];
  if (!process.env.CLERK_SECRET_KEY) missing.push("CLERK_SECRET_KEY");
  if (!process.env.CLERK_PUBLISHABLE_KEY) missing.push("CLERK_PUBLISHABLE_KEY");
  if (missing.length > 0) {
    throw new Error(
      `Missing required Clerk environment variables: ${missing.join(", ")}. ` +
        `Auth will not function without these. Configure them in the Replit Auth pane.`,
    );
  }
}

async function main() {
  assertClerkEnv();
  await setupAuth(app);
  app.use("/api", healthRouter);
  app.use("/api", trackActiveUser);
  registerAuthRoutes(app);
  registerActiveUserRoutes(app);
  const server = http.createServer(app);
  await registerRoutes(server, app);

  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

main().catch((err) => {
  logger.error({ err }, "Fatal error during startup");
  process.exit(1);
});
