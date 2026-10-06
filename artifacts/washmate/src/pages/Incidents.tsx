import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, Redirect, useLocation, useParams } from 'wouter';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Incident, incidentRequest, money, ReimbursementAccount, useIncidentAccess, useIncidentMutation } from '@/hooks/use-incidents';
import { IncidentError, IncidentEvidence, IncidentTerms, WasherIncidentSummary } from '@/components/IncidentSupport';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';

const statusLabel = { submitted: 'Awaiting WashMate review', approved: 'Approved', rejected: 'Rejected' };
const reimbursementLabel = { none: 'No reimbursement scheduled', pending: 'Pending — not yet paid', paid: 'Paid', failed: 'Failed — needs administrator attention' };

function CustomerReimbursement() {
  const account = useQuery({
    queryKey: ['/api/incidents/reimbursement/status'],
    queryFn: () => incidentRequest<ReimbursementAccount>('/api/incidents/reimbursement/status'),
    refetchInterval: 30_000,
  });
  const setup = useIncidentMutation(() => incidentRequest<{ url: string }>('/api/incidents/reimbursement/setup', {}));
  return <section className="rounded-2xl border bg-card p-5 space-y-3">
    <h2 className="font-display font-bold text-xl">Receive a reimbursement</h2>
    <p className="text-sm text-muted-foreground">Set up your separate Stripe Connect payout account to receive an approved reimbursement. This is not a refund of the customer unlock fee. Finishing setup does not mean a claim has been approved or paid.</p>
    {account.isLoading && <p role="status">Checking payout setup…</p>}
    <IncidentError error={account.error} retry={() => void account.refetch()} />
    {account.data && <>
      <p className="text-sm font-semibold">{account.data.ready ? 'Payout account ready' : account.data.accountId ? 'Payout setup incomplete or awaiting Stripe verification' : 'Payout account not set up'}</p>
      {account.data.accountId && <p className="text-xs text-muted-foreground">Transfers: {account.data.transfersActive ? 'active' : 'not active'} · Payouts: {account.data.payoutsEnabled ? 'enabled' : 'not enabled'}</p>}
      <div className="flex flex-wrap gap-3">
        <Button variant="outline" disabled={setup.isPending} onClick={() => setup.mutate(undefined, { onSuccess: data => window.location.assign(data.url) })}>{setup.isPending ? 'Opening Stripe…' : account.data.accountId ? 'Review Stripe payout setup' : 'Set up payouts with Stripe'}</Button>
        <Button variant="ghost" disabled={account.isFetching} onClick={() => void account.refetch()}>Refresh status</Button>
      </div>
    </>}
    <IncidentError error={setup.error} />
  </section>;
}

function WasherResponse({ incident }: { incident: Incident }) {
  const [response, setResponse] = useState(incident.washerResponse ?? '');
  const save = useIncidentMutation((value: string) => incidentRequest<Incident>(`/api/incidents/${incident.id}/respond`, { response: value }));
  return <form className="space-y-3" onSubmit={event => { event.preventDefault(); save.mutate(response.trim()); }}>
    <Label htmlFor="washer-response">Your response for WashMate review</Label>
    <Textarea id="washer-response" required minLength={5} maxLength={5000} value={response} onChange={event => setResponse(event.target.value)} placeholder="Share what happened and any relevant context. You can also upload evidence." />
    <IncidentError error={save.error} />
    {save.isSuccess && <p role="status" className="text-sm text-primary">Response saved.</p>}
    <Button disabled={save.isPending || response.trim().length < 5}>{save.isPending ? 'Saving…' : 'Save response'}</Button>
  </form>;
}

function AdminReview({ incident }: { incident: Incident }) {
  const [decision, setDecision] = useState<'approved' | 'rejected'>('approved');
  const [amount, setAmount] = useState('0.00');
  const [note, setNote] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const cents = Math.round(Number(amount) * 100);
  const review = useIncidentMutation(() => incidentRequest<Incident>(`/api/admin/incidents/${incident.id}/review`, {
    decision, reimbursementCents: decision === 'approved' ? cents : 0, reviewNote: note.trim(),
  }));
  const pay = useIncidentMutation(() => incidentRequest<Incident>(`/api/admin/incidents/${incident.id}/pay`, {}));
  return <section className="rounded-2xl border border-primary/30 bg-primary/5 p-5 space-y-4">
    <h2 className="font-display font-bold text-xl flex gap-2 items-center"><ShieldCheck className="h-5 w-5" /> WashMate review</h2>
    {incident.status === 'submitted' ? <form className="space-y-4" onSubmit={event => { event.preventDefault(); review.mutate(undefined); }}>
      <p className="text-sm">Review the private evidence and washer response before deciding. Approval records one lifetime incident and charges the washer $3.99 exactly once. Reimbursement is a separate decision, capped at $50.</p>
      {!incident.washerResponse && <p className="text-sm font-semibold">No washer response has been submitted yet.</p>}
      <div className="space-y-2"><Label htmlFor="review-decision">Decision</Label><select id="review-decision" className="w-full border rounded-md p-3 bg-background text-sm" value={decision} onChange={event => { setDecision(event.target.value as 'approved' | 'rejected'); setConfirmed(false); }}><option value="approved">Approve incident</option><option value="rejected">Reject incident</option></select></div>
      {decision === 'approved' && <div className="space-y-2"><Label htmlFor="review-amount">Customer reimbursement (USD, $0–$50)</Label><Input id="review-amount" type="number" min="0" max="50" step="0.01" required value={amount} onChange={event => setAmount(event.target.value)} /><p className="text-xs text-muted-foreground">Approving requires uploaded evidence. $0 approves the incident without a customer payout.</p></div>}
      <div className="space-y-2"><Label htmlFor="review-note">{decision === 'rejected' ? 'Reason for rejection' : 'Review explanation'}</Label><Textarea id="review-note" required maxLength={5000} value={note} onChange={event => setNote(event.target.value)} /></div>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />I have reviewed this case and understand that this decision is final.</label>
      <IncidentError error={review.error} />
      <Button disabled={review.isPending || !confirmed || !note.trim() || (decision === 'approved' && (!incident.evidence?.length || amount === '' || !Number.isFinite(cents) || cents < 0 || cents > 5000))}>{review.isPending ? 'Saving decision…' : decision === 'approved' ? 'Approve incident' : 'Reject incident'}</Button>
    </form> : <p className="text-sm">Final decision: {statusLabel[incident.status]}. The review cannot be submitted again.</p>}
    {incident.status === 'approved' && incident.reimbursementCents > 0 && incident.reimbursementStatus !== 'paid' && <>
      <p className="text-sm">Customer reimbursement: {money(incident.reimbursementCents)} · {reimbursementLabel[incident.reimbursementStatus]}. The customer must finish payout setup. Starting a payout does not guarantee it is paid; the status below reflects the server’s confirmed result.</p>
      <Button disabled={pay.isPending} onClick={() => pay.mutate(undefined)}>{pay.isPending ? 'Checking payout…' : incident.reimbursementStatus === 'pending' ? 'Initiate / reconcile reimbursement' : 'Retry reimbursement'}</Button>
      <IncidentError error={pay.error} />
      {pay.isSuccess && <p role="status" className="text-sm">Reimbursement action completed. Current status: {reimbursementLabel[pay.data.reimbursementStatus]}.</p>}
    </>}
  </section>;
}

function IncidentDetail({ id, isAdmin }: { id: number; isAdmin: boolean }) {
  const { user } = useAuth();
  const detail = useQuery({
    queryKey: ['/api/incidents', id, user?.id],
    queryFn: () => incidentRequest<Incident>(`/api/incidents/${id}`),
    refetchInterval: 20_000,
  });
  const incident = detail.data;
  if (detail.isLoading) return <p role="status">Loading case…</p>;
  if (!incident) return <IncidentError error={detail.error || new Error('Case not found.')} retry={() => void detail.refetch()} />;
  const isCustomer = String(user?.id) === String(incident.customerId);
  const isWasher = String(user?.id) === String(incident.washerId);
  return <div className="space-y-6">
    <IncidentError error={detail.error} retry={() => void detail.refetch()} />
    <section className="glass-card rounded-3xl p-6 space-y-5">
      <div className="flex flex-wrap justify-between gap-3"><div><h2 className="text-2xl font-display font-bold">Case #{incident.id}</h2><p className="text-sm text-muted-foreground">Order #{incident.orderId} · {new Date(incident.createdAt).toLocaleDateString()}</p></div><span className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold self-start">{statusLabel[incident.status]}</span></div>
      <div><h3 className="font-semibold capitalize">{incident.category} item report</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{incident.description}</p></div>
      <div><h3 className="font-semibold">Washer response</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{incident.washerResponse || 'No response yet.'}</p></div>
      {incident.reviewNote && <div><h3 className="font-semibold">WashMate review notes</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm">{incident.reviewNote}</p></div>}
      <div className="rounded-xl bg-secondary/50 p-4 text-sm space-y-1"><p className="font-semibold">Customer reimbursement: {money(incident.reimbursementCents)}</p><p>{reimbursementLabel[incident.reimbursementStatus]}</p>{incident.status === 'submitted' && <p>No reimbursement decision has been made.</p>}</div>
      {isWasher && incident.status === 'submitted' && <WasherResponse key={incident.id} incident={incident} />}
      <IncidentEvidence incident={incident} canUpload={(isCustomer || isWasher) && incident.status === 'submitted'} />
      <Button variant="ghost" disabled={detail.isFetching} onClick={() => void detail.refetch()}>Refresh case</Button>
    </section>
    {isAdmin && <AdminReview incident={incident} />}
    {isCustomer && <CustomerReimbursement />}
    <IncidentTerms />
  </div>;
}

export default function Incidents() {
  const { user, isAuthenticated, isLoading } = useAuth();
  const [location] = useLocation();
  const params = useParams<{ id?: string }>();
  const access = useIncidentAccess();
  const adminPage = location.startsWith('/admin/incidents');
  const path = adminPage ? '/api/admin/incidents' : '/api/incidents';
  const list = useQuery({
    queryKey: [path, user?.id],
    queryFn: () => incidentRequest<{ incidents: Incident[] }>(path),
    enabled: !!user && !params.id && (!adminPage || !!access.data?.isAdmin),
    refetchInterval: 30_000,
  });
  if (isLoading) return <p role="status" className="p-8">Loading account…</p>;
  if (!isAuthenticated) return <Redirect to="/" />;
  return <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
    <Link href={params.id ? (adminPage ? '/admin/incidents' : '/incidents') : user?.role === 'washer' ? '/washer' : '/customer'} className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{params.id ? 'Back to reports' : 'Back to dashboard'}</Link>
    <header><h1 className="text-3xl font-display font-bold">{adminPage ? 'WashMate incident review' : 'Incident support'}</h1><p className="mt-2 text-muted-foreground">{adminPage ? 'Review reports fairly and manage approved reimbursements.' : 'A clear record of reports, evidence, and review decisions.'}</p></header>
    {access.isLoading && <p role="status">Checking incident access…</p>}
    <IncidentError error={access.error} retry={() => void access.refetch()} />
    {adminPage && access.data && !access.data.isAdmin ? <p role="alert">This page is restricted to WashMate administrators.</p> : access.data && <>
      {access.data.isAdmin && <div className="flex flex-wrap gap-4 text-sm text-primary underline"><Link href="/incidents">Incident history</Link><Link href="/admin/incidents">Admin review queue</Link></div>}
      {params.id ? Number.isSafeInteger(Number(params.id)) && Number(params.id) > 0 ? <IncidentDetail id={Number(params.id)} isAdmin={access.data.isAdmin} /> : <p role="alert">Invalid case number.</p> : <>
        {user?.role === 'washer' && <WasherIncidentSummary />}
        {user?.role === 'customer' && !adminPage && <CustomerReimbursement />}
        <section className="space-y-3">
          <div className="flex justify-between items-center gap-3"><h2 className="text-xl font-display font-bold">{adminPage ? 'All reports' : 'Report history'}</h2><Button variant="ghost" disabled={list.isFetching} onClick={() => void list.refetch()}>Refresh</Button></div>
          {list.isLoading && <p role="status">Loading reports…</p>}
          <IncidentError error={list.error} retry={() => void list.refetch()} />
          {list.data?.incidents.length === 0 && <div className="rounded-2xl border p-6 text-sm text-muted-foreground">No reports yet.{user?.role === 'customer' && ' To report an item, open the assigned order in your dashboard and choose “Report an incident”.'}</div>}
          {list.data?.incidents.map(incident => <Link key={incident.id} href={`${adminPage ? '/admin' : ''}/incidents/${incident.id}`} className="block rounded-2xl border bg-card p-5 hover:border-primary/50 transition-colors">
            <div className="flex flex-wrap justify-between gap-2"><h3 className="font-semibold">Case #{incident.id} · Order #{incident.orderId}</h3><span className="text-xs font-semibold rounded-full bg-secondary px-3 py-1">{statusLabel[incident.status]}</span></div>
            <p className="mt-2 text-sm capitalize">{incident.category} item · {new Date(incident.createdAt).toLocaleDateString()}</p><p className="text-sm text-muted-foreground line-clamp-2 mt-1">{incident.description}</p>
            <p className="text-xs text-muted-foreground mt-3">{money(incident.reimbursementCents)} reimbursement · {reimbursementLabel[incident.reimbursementStatus]}</p>
          </Link>)}
        </section>
        <IncidentTerms />
      </>}
    </>}
  </main>;
}