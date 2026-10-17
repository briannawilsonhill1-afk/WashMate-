import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "../db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// Liveness: the process is up. Stays trivial so orchestrators never confuse
// a downstream blip (e.g. a slow database) with a dead process.
router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Tables the money paths depend on. Kept explicit so a half-applied
// migration fails readiness instead of failing payouts at runtime.
const REQUIRED_TABLES = ["users", "washer_profiles", "payouts", "orders"];

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`readiness check timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// Readiness: the process can actually serve traffic — database connectivity
// plus the required schema, each with a short timeout. Returns 200 only when
// every check passes; otherwise 503 with per-check detail (no secret values).
router.get("/readyz", async (_req, res) => {
  const checks: Record<string, string> = {};
  try {
    await withTimeout(pool.query("SELECT 1"), 3000);
    checks.database = "ok";
  } catch (err: any) {
    checks.database = `unreachable: ${err?.message ?? "unknown error"}`;
  }

  if (checks.database === "ok") {
    try {
      const { rows } = await withTimeout(
        pool.query(
          `SELECT table_name FROM information_schema.tables
           WHERE table_schema = 'public' AND table_name = ANY($1)`,
          [REQUIRED_TABLES],
        ),
        3000,
      );
      const found = new Set(rows.map((r: { table_name: string }) => r.table_name));
      const missing = REQUIRED_TABLES.filter((t) => !found.has(t));
      checks.schema = missing.length === 0 ? "ok" : `missing tables: ${missing.join(", ")}`;
    } catch (err: any) {
      checks.schema = `unavailable: ${err?.message ?? "unknown error"}`;
    }
  }

  const ready = Object.values(checks).every((v) => v === "ok");
  if (!ready) {
    logger.warn({ checks }, "Readiness check failed");
    return res.status(503).json({ status: "degraded", checks });
  }
  return res.json(HealthCheckResponse.parse({ status: "ok" }));
});

export default router;
