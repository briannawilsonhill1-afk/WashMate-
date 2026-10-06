import express, { type Express, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { Client } from "@replit/object-storage";
import { z } from "zod";
import { pool } from "./db";
import { isAuthenticated, getUserId } from "./auth";
import { canReadIncident, isIncidentAdmin, retryWindowOpen } from "./incidentPolicy";
import { getUncachableStripeClient } from "./stripeClient";
// Infer from the promise overload and the same pg installation as our pool.
const connectIncidentClient = () => pool.connect();
type PoolClient = Awaited<ReturnType<typeof connectIncidentClient>>;

class IncidentError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function fail(status: number, message: string): never { throw new IncidentError(status, message); }
async function transaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try { await c.query("BEGIN"); const result = await fn(c); await c.query("COMMIT"); return result; }
  catch (e) { await c.query("ROLLBACK"); throw e; }
  finally { c.release(); }
}
function route(fn: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    try { await fn(req, res); }
    catch (e: any) {
      if (e instanceof z.ZodError) { res.status(400).json({error: "Invalid incident request"}); return; }
      if (e?.code === "23505") { res.status(409).json({error: "An incident already exists for this order"}); return; }
      res.status(e instanceof IncidentError ? e.status : 503).json({
        error: e instanceof IncidentError ? e.message : "Incident service unavailable. Please retry later.",
      });
    }
  };
}
function id(req: Request): number { return z.coerce.number().int().positive().parse(req.params.id); }
function publicIncident(r: any) {
  return {
    id: r.id, orderId: r.order_id, customerId: r.customer_id, washerId: r.washer_id,
    category: r.category, description: r.description, status: r.status,
    washerResponse: r.washer_response, reviewNote: r.review_note,
    reimbursementCents: r.reimbursement_cents, reimbursementStatus: r.reimbursement_status,
    createdAt: r.created_at,
  };
}
async function authorized(c: Pick<PoolClient, "query">, incidentId: number, uid: string, lock = false) {
  const r = (await c.query(`SELECT * FROM incidents WHERE id=$1${lock ? " FOR UPDATE" : ""}`, [incidentId])).rows[0];
  if (!r || !canReadIncident(uid, publicIncident(r))) fail(404, "Incident not found");
  return r;
}
function admin(req: Request) {
  if (!isIncidentAdmin(getUserId(req))) fail(403, "Administrator access required");
}
function storageClient() {
  // Explicit bucket avoids accidentally using an unrelated default bucket.
  const bucketId = process.env.INCIDENT_EVIDENCE_BUCKET_ID;
  if (!bucketId) fail(503, "Private evidence storage is not provisioned. Configure INCIDENT_EVIDENCE_BUCKET_ID.");
  return new Client({bucketId});
}
const evidenceView = (r: any) => ({
  id: r.id, downloadPath: `/api/incidents/${r.incident_id}/evidence/${r.id}`,
  contentType: r.content_type, size: r.size,
});
export function validEvidence(bytes: Buffer, type: string) {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) return false;
  if (type === "image/jpeg") return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (type === "image/png") return bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
  if (type === "application/pdf") return bytes.subarray(0, 5).toString() === "%PDF-";
  return false;
}
async function readiness(uid: string) {
  const row = (await pool.query("SELECT account_id FROM reimbursement_accounts WHERE user_id=$1", [uid])).rows[0];
  if (!row?.account_id) return {accountId: null, ready: false, payoutsEnabled: false, transfersActive: false};
  const stripe = await getUncachableStripeClient();
  const account = await stripe.accounts.retrieve(row.account_id);
  const payoutsEnabled = !!account.payouts_enabled;
  const transfersActive = account.capabilities?.transfers === "active";
  return {accountId: account.id, ready: payoutsEnabled && transfersActive && !!account.details_submitted, payoutsEnabled, transfersActive};
}

export function registerIncidentRoutes(app: Express) {
  const list = route(async (req, res) => {
    if (req.path.startsWith("/api/admin")) admin(req);
    const uid = getUserId(req);
    const rows = await pool.query("SELECT * FROM incidents WHERE $2::boolean OR customer_id=$1 OR washer_id=$1 ORDER BY id DESC LIMIT 500", [uid, isIncidentAdmin(uid)]);
    res.json({incidents: rows.rows.map(publicIncident)});
  });
  app.get("/api/incidents/access", isAuthenticated, route(async (req, res) => {
    const uid = getUserId(req);
    const counts = await pool.query("SELECT count(*)::integer AS n FROM incidents WHERE washer_id=$1 AND status='approved'", [uid]);
    const debt = await pool.query(`SELECT COALESCE(SUM(f.amount_cents - COALESCE((
      SELECT SUM(a.amount_cents) FROM incident_fee_allocations a JOIN payouts p ON p.id=a.payout_id
      WHERE a.fee_id=f.id AND p.status='paid'),0)),0)::integer AS n FROM incident_fees f WHERE f.washer_id=$1`, [uid]);
    const approvedIncidentCount = counts.rows[0].n;
    res.json({isAdmin: isIncidentAdmin(uid), approvedIncidentCount, workBlocked: approvedIncidentCount >= 3, outstandingFeeCents: debt.rows[0].n});
  }));
  app.get("/api/incidents/reimbursement/status", isAuthenticated, route(async (req, res) => {
    res.json(await readiness(getUserId(req)));
  }));
  app.post("/api/incidents/reimbursement/setup", isAuthenticated, route(async (req, res) => {
    const uid = getUserId(req);
    const eligible = await pool.query("SELECT 1 FROM incidents WHERE customer_id=$1 LIMIT 1", [uid]);
    if (!eligible.rowCount) fail(403, "A customer incident is required for reimbursement onboarding");
    const host = (process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim();
    if (!host || !/^[a-zA-Z0-9.-]+$/.test(host)) fail(503, "Reimbursement return domain is not configured");
    const stripe = await getUncachableStripeClient();
    await pool.query("INSERT INTO reimbursement_accounts(user_id) VALUES($1) ON CONFLICT DO NOTHING", [uid]);
    const accountId = await transaction(async c => {
      const row = (await c.query("SELECT * FROM reimbursement_accounts WHERE user_id=$1 FOR UPDATE", [uid])).rows[0];
      if (row.account_id) return row.account_id as string;
      if (!retryWindowOpen(row.attempted_at)) fail(409, "Account creation needs administrator reconciliation before retry");
      const account = await stripe.accounts.create({
        type: "express", country: "US", capabilities: {transfers: {requested: true}},
        settings: {payouts: {schedule: {interval: "manual"}}},
        metadata: {washmateReimbursementCustomerId: uid},
      }, {idempotencyKey: `wm_reimbursement_account_${uid}`});
      await c.query("UPDATE reimbursement_accounts SET account_id=$2 WHERE user_id=$1", [uid, account.id]);
      return account.id;
    });
    const link = await stripe.accountLinks.create({
      account: accountId, type: "account_onboarding",
      refresh_url: `https://${host}/incidents?reimbursement=refresh`,
      return_url: `https://${host}/incidents?reimbursement=return`,
    });
    res.json({url: link.url});
  }));
  app.get("/api/incidents", isAuthenticated, list);
  app.get("/api/admin/incidents", isAuthenticated, list);
  app.post("/api/incidents", isAuthenticated, route(async (req, res) => {
    const input = z.object({orderId: z.number().int().positive(), category: z.enum(["missing","damaged","sentimental","valuable"]), description: z.string().trim().min(10).max(4000)}).strict().parse(req.body);
    const uid = getUserId(req);
    const result = await transaction(async c => {
      const order = (await c.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [input.orderId])).rows[0];
      if (!order || order.customer_id !== uid) fail(404, "Order not found");
      if (!order.washer_id) fail(409, "The order must have an assigned washer");
      return (await c.query(`INSERT INTO incidents(order_id,customer_id,washer_id,category,description)
        VALUES($1,$2,$3,$4,$5) RETURNING *`, [input.orderId,uid,order.washer_id,input.category,input.description])).rows[0];
    });
    res.status(201).json(publicIncident(result));
  }));
  app.get("/api/incidents/:id", isAuthenticated, route(async (req, res) => {
    const r = await authorized(pool, id(req), getUserId(req));
    const evidence = await pool.query("SELECT * FROM incident_evidence WHERE incident_id=$1 ORDER BY created_at", [r.id]);
    res.json({...publicIncident(r), evidence: evidence.rows.map(evidenceView)});
  }));
  app.post("/api/incidents/:id/respond", isAuthenticated, route(async (req, res) => {
    const input = z.object({response: z.string().trim().min(1).max(4000)}).strict().parse(req.body);
    const r = await transaction(async c => {
      const row = await authorized(c, id(req), getUserId(req), true);
      if (row.washer_id !== getUserId(req)) fail(403, "Only the assigned washer may respond");
      if (row.status !== "submitted") fail(409, "Reviewed incidents cannot be edited");
      return (await c.query("UPDATE incidents SET washer_response=$2 WHERE id=$1 RETURNING *", [row.id,input.response])).rows[0];
    });
    res.json(publicIncident(r));
  }));
  app.post("/api/incidents/:id/evidence", isAuthenticated,
    // Authorize before allocating upload body memory.
    async (req, res, next) => {
      try { await authorized(pool, id(req), getUserId(req)); next(); }
      catch { res.status(404).json({error: "Incident not found"}); }
    },
    express.raw({type: ["image/jpeg","image/png","application/pdf"], limit: "5mb"}),
    route(async (req, res) => {
      const type = req.headers["content-type"]?.split(";")[0] ?? "";
      if (!Buffer.isBuffer(req.body) || !validEvidence(req.body, type)) fail(400, "A valid JPEG, PNG or PDF up to 5MB is required");
      const client = storageClient();
      const result = await transaction(async c => {
        const row = await authorized(c, id(req), getUserId(req), true);
        if (row.status !== "submitted") fail(409, "Reviewed incidents cannot be edited");
        if ((await c.query("SELECT id FROM incident_evidence WHERE incident_id=$1", [row.id])).rowCount! >= 10) fail(409, "Maximum 10 evidence files per incident");
        const evidenceId = randomUUID();
        const objectKey = `private/incidents/${row.id}/${evidenceId}`;
        const uploaded = await client.uploadFromBytes(objectKey, req.body);
        if (!uploaded.ok) fail(503, "Private evidence storage unavailable");
        return (await c.query(`INSERT INTO incident_evidence(id,incident_id,uploader_id,object_key,content_type,size)
          VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [evidenceId,row.id,getUserId(req),objectKey,type,req.body.length])).rows[0];
      });
      res.status(201).json(evidenceView(result));
    }));
  app.get("/api/incidents/:id/evidence/:evidenceId", isAuthenticated, route(async (req, res) => {
    const row = await authorized(pool, id(req), getUserId(req));
    const evidenceId = z.string().uuid().parse(req.params.evidenceId);
    const e = (await pool.query("SELECT * FROM incident_evidence WHERE id=$1 AND incident_id=$2", [evidenceId,row.id])).rows[0];
    if (!e) fail(404, "Evidence not found");
    const result = await storageClient().downloadAsBytes(e.object_key);
    if (!result.ok) fail(503, "Private evidence storage unavailable");
    res.set({"Content-Type": e.content_type, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `attachment; filename="evidence-${e.id}"`});
    res.send(Buffer.from(result.value[0]));
  }));
  app.post("/api/admin/incidents/:id/review", isAuthenticated, route(async (req, res) => {
    admin(req);
    const input = z.object({
      decision: z.enum(["approved","rejected"]), reimbursementCents: z.number().int().min(0).max(5000),
      reviewNote: z.string().trim().min(1).max(4000),
    }).strict().parse(req.body);
    if (input.decision === "rejected" && input.reimbursementCents !== 0) fail(400, "Rejected incidents cannot have reimbursement");
    const row = await transaction(async c => {
      // Global lock order: washer user, then case. Same user lock as claim/payout.
      const first = await authorized(c, id(req), getUserId(req));
      await c.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [first.washer_id]);
      const r = await authorized(c, first.id, getUserId(req), true);
      if (r.status !== "submitted") {
        if (r.status === input.decision && r.reimbursement_cents === input.reimbursementCents) return r;
        fail(409, "Incident has already been reviewed");
      }
      if (input.decision === "approved") {
        if (!(await c.query("SELECT 1 FROM incident_evidence WHERE incident_id=$1 LIMIT 1", [r.id])).rowCount) fail(409, "Evidence is required for approval");
        await c.query("INSERT INTO incident_fees(incident_id,washer_id) VALUES($1,$2)", [r.id,r.washer_id]);
      }
      return (await c.query(`UPDATE incidents SET status=$2,reimbursement_cents=$3,review_note=$4,reviewed_by=$5
        WHERE id=$1 RETURNING *`, [r.id,input.decision,input.reimbursementCents,input.reviewNote,getUserId(req)])).rows[0];
    });
    res.json(publicIncident(row));
  }));
  app.post("/api/admin/incidents/:id/pay", isAuthenticated, route(async (req, res) => {
    admin(req);
    await payReimbursement(id(req));
    res.json(publicIncident(await authorized(pool, id(req), getUserId(req))));
  }));
}

// Persist the attempt before external calls. Stripe keys are safe to replay only
// within their retention window; older unknown outcomes fail closed, never resend.
export async function payReimbursement(incidentId: number) {
  const stripe = await getUncachableStripeClient();
  await transaction(async c => {
    const r = (await c.query("SELECT * FROM incidents WHERE id=$1 FOR UPDATE", [incidentId])).rows[0];
    if (!r) fail(404, "Incident not found");
    if (r.status !== "approved" || r.reimbursement_cents <= 0) fail(409, "A positive approved reimbursement is required");
    if (r.reimbursement_status === "paid") return;
    const account = await readiness(r.customer_id);
    if (!account.ready) fail(409, "Customer must complete reimbursement bank verification");
    await c.query(`UPDATE incidents SET reimbursement_account_id=COALESCE(reimbursement_account_id,$2),
      transfer_attempt_at=COALESCE(transfer_attempt_at,NOW()),reimbursement_status='pending' WHERE id=$1`, [r.id,account.accountId]);
  });
  await transaction(async c => {
    const r = (await c.query("SELECT * FROM incidents WHERE id=$1 FOR UPDATE", [incidentId])).rows[0];
    if (r.reimbursement_status === "paid" || r.transfer_id) return;
    if (!retryWindowOpen(r.transfer_attempt_at)) fail(409, "Transfer outcome requires Stripe reconciliation; no new transfer was sent");
    const transfer = await stripe.transfers.create({
      amount: r.reimbursement_cents, currency: "usd", destination: r.reimbursement_account_id,
      metadata: {washmateIncidentId: String(r.id)},
    }, {idempotencyKey: `wm_incident_transfer_${r.id}`});
    await c.query("UPDATE incidents SET transfer_id=$2 WHERE id=$1", [r.id,transfer.id]);
  });
  await pool.query("UPDATE incidents SET payout_attempt_at=COALESCE(payout_attempt_at,NOW()) WHERE id=$1 AND transfer_id IS NOT NULL", [incidentId]);
  await transaction(async c => {
    const r = (await c.query("SELECT * FROM incidents WHERE id=$1 FOR UPDATE", [incidentId])).rows[0];
    if (r.reimbursement_status === "paid") return;
    if (!r.transfer_id) fail(409, "Transfer has not been confirmed");
    let bankPayout;
    if (r.bank_payout_id) {
      bankPayout = await stripe.payouts.retrieve(r.bank_payout_id, {stripeAccount: r.reimbursement_account_id});
    } else {
      if (!retryWindowOpen(r.payout_attempt_at)) fail(409, "Bank payout outcome requires Stripe reconciliation; no new transfer was sent");
      bankPayout = await stripe.payouts.create({
        amount: r.reimbursement_cents, currency: "usd", metadata: {washmateIncidentId: String(r.id)},
      }, {stripeAccount: r.reimbursement_account_id, idempotencyKey: `wm_incident_bank_${r.id}`});
    }
    await c.query(`UPDATE incidents SET bank_payout_id=$2,reimbursement_status=$3 WHERE id=$1`,
      [r.id, bankPayout.id, bankPayout.status === "paid" ? "paid" : ["failed","canceled"].includes(bankPayout.status) ? "failed" : "pending"]);
  });
}

export async function reconcileIncidentPayout(event: {type: string; account?: string; data: {object: any}}): Promise<boolean> {
  const p = event.data.object;
  if (!p.metadata?.washmateIncidentId) return false;
  const n = Number(p.metadata.washmateIncidentId);
  if (!Number.isSafeInteger(n) || !event.account) return true;
  const stripe = await getUncachableStripeClient();
  // Retrieve canonical current state: delayed webhook delivery cannot regress paid.
  const current = await stripe.payouts.retrieve(p.id, {stripeAccount: event.account});
  await pool.query(`UPDATE incidents SET bank_payout_id=$2,reimbursement_status=$3
    WHERE id=$1 AND reimbursement_account_id=$4 AND transfer_id IS NOT NULL
    AND (bank_payout_id=$2 OR bank_payout_id IS NULL)`,
    [n,current.id,current.status === "paid" ? "paid" : ["failed","canceled"].includes(current.status) ? "failed" : "pending",event.account]);
  return true;
}