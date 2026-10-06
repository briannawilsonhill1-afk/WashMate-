import type { IncomingMessage, ServerResponse } from "http";
import { initApp } from "./createApp";
import { logger } from "./lib/logger";

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    const { app } = await initApp();
    app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
  } catch (err) {
    logger.error({ err }, "API failed to initialize");
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ message: "Service temporarily unavailable" }));
  }
}
