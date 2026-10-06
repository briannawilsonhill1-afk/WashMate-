import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Incident, incidentRequest, money, useIncidentAccess, useIncidentMutation } from '@/hooks/use-incidents';

export function IncidentError({ error, retry }: { error: unknown; retry?: () => void }) {
  if (!error) return null;
  return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
    <p>{error instanceof Error ? error.message : 'Unable to load this information.'}</p>
    {retry && <Button variant="outline" size="sm" className="mt-2" onClick={retry}>Try again</Button>}
  </div>;
}

export function IncidentTerms() {
  return <div className="rounded-2xl border bg-secondary/40 p-5 text-sm space-y-2">
    <h2 className="font-semibold flex gap-2 items-center"><ShieldCheck className="h-4 w-4" /> Fair review, not automatic blame</h2>
    <p>Submitting a report does not establish fault or count against a washer. WashMate reviews the evidence and the washer’s response before approving or rejecting a case.</p>
    <p>Each approved incident carries a one-time <strong>$3.99 washer fee</strong>, deducted from earnings with any unpaid balance carried forward. This fee is separate from the customer’s reimbursement.</p>
    <p>With appropriate evidence, an approved customer reimbursement may be up to <strong>$50 per incident</strong>, including claims involving sentimental or valuable items. Reimbursement is not guaranteed. Three lifetime approved incidents block a washer from claiming new work; pending or rejected reports do not count.</p>
  </div>;
}

export function WasherIncidentSummary() {
  const access = useIncidentAccess();
  return <section className="rounded-2xl border bg-card p-5 mb-6 space-y-3" aria-label="Incident standing">
    <div className="flex flex-wrap justify-between gap-3"><h2 className="font-semibold">Incident standing</h2><Link href="/incidents" className="text-primary text-sm font-semibold underline">View reports & respond</Link></div>
    {access.isLoading && <p role="status" className="text-sm text-muted-foreground">Checking work eligibility…</p>}
    <IncidentError error={access.error} retry={() => void access.refetch()} />
    {access.data && <>
      <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <p><strong>{access.data.approvedIncidentCount} / 3</strong> lifetime approved incidents</p>
        <p><strong>{Math.max(0, 3 - access.data.approvedIncidentCount)}</strong> approvals until new work is blocked</p>
        <p>Outstanding fees: <strong>{money(access.data.outstandingFeeCents)}</strong></p>
      </div>
      <p className="text-xs text-muted-foreground">Only approved incidents count. Each approved incident incurs $3.99 once; unpaid fees carry forward against future earnings.</p>
      {access.data.workBlocked && <p role="alert" className="font-semibold text-destructive">New work is blocked after three lifetime approved incidents. You can still manage your existing orders and respond to reports.</p>}
    </>}
  </section>;
}

export function OrderIncidentReport({ orderId }: { orderId: number }) {
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<Incident['category']>('missing');
  const [description, setDescription] = useState('');
  const list = useQuery({
    queryKey: ['/api/incidents', 'order', orderId],
    queryFn: () => incidentRequest<{ incidents: Incident[] }>('/api/incidents'),
  });
  const existing = list.data?.incidents.find(item => item.orderId === orderId);
  const create = useIncidentMutation((body: { orderId: number; category: Incident['category']; description: string }) => incidentRequest<Incident>('/api/incidents', body));
  return <section className="glass-card rounded-3xl p-6 mt-6 space-y-4">
    <h2 className="text-xl font-display font-bold">Missing or damaged items?</h2>
    <p className="text-sm text-muted-foreground">Report a concern about this order, including sentimental or valuable items. You can securely add photos, receipts, or other evidence after creating your case.</p>
    <IncidentError error={list.error} retry={() => void list.refetch()} />
    {existing ? <Link href={`/incidents/${existing.id}`} className="text-primary font-semibold underline">View report · {existing.status === 'submitted' ? 'Awaiting review' : existing.status}</Link> :
      !open ? <Button variant="outline" disabled={!list.data} onClick={() => setOpen(true)}>{list.isLoading ? 'Checking reports…' : 'Report an incident'}</Button> :
        <form className="space-y-4" onSubmit={event => {
          event.preventDefault();
          create.mutate({ orderId, category, description: description.trim() }, { onSuccess: item => navigate(`/incidents/${item.id}`) });
        }}>
          <IncidentTerms />
          <div className="space-y-2"><Label htmlFor="incident-category">Type of concern</Label>
            <select id="incident-category" className="w-full rounded-md border bg-background p-3 text-sm" value={category} onChange={event => setCategory(event.target.value as Incident['category'])}>
              <option value="missing">Missing item</option><option value="damaged">Damaged item</option><option value="sentimental">Sentimental item claim</option><option value="valuable">Valuable item claim</option>
            </select></div>
          <div className="space-y-2"><Label htmlFor="incident-description">What happened?</Label><Textarea id="incident-description" required minLength={10} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Describe the items, what is missing or damaged, when you noticed, and any value you are claiming." /></div>
          <IncidentError error={create.error} />
          <div className="flex gap-3"><Button type="submit" disabled={create.isPending || description.trim().length < 10}>{create.isPending ? 'Submitting…' : 'Create report & add evidence'}</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>}
  </section>;
}

export function IncidentEvidence({ incident, canUpload }: { incident: Incident; canUpload: boolean }) {
  const [file, setFile] = useState<File | null>(null);
  const [fileKey, setFileKey] = useState(0);
  const upload = useIncidentMutation(async (selected: File) => {
    if (!['image/jpeg', 'image/png', 'application/pdf'].includes(selected.type)) throw new Error('Choose a JPEG, PNG, or PDF file.');
    if (selected.size > 5 * 1024 * 1024) throw new Error('Each file must be 5 MB or smaller.');
    const result = await fetch(`/api/incidents/${incident.id}/evidence`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': selected.type, 'X-Filename': encodeURIComponent(selected.name) },
      body: selected,
    });
    if (!result.ok) {
      const data = await result.json().catch(() => null);
      throw new Error(data?.error || 'Upload failed. Please try again.');
    }
    return result.json();
  });
  return <section className="space-y-4">
    <h2 className="font-display text-xl font-bold">Private evidence</h2>
    <p className="text-sm text-muted-foreground">Visible only to the customer, assigned washer, and WashMate reviewers. Add item photos and appropriate proof of ownership, value, or damage. Do not upload bank details or identity documents here.</p>
    {incident.evidence?.length ? <ul className="space-y-2">{incident.evidence.map((item, index) =>
      <li key={item.id}><a className="flex justify-between gap-3 rounded-xl border p-3 text-primary hover:bg-secondary text-sm" href={`/api/incidents/${incident.id}/evidence/${item.id}`} target="_blank" rel="noopener noreferrer">View evidence {index + 1} · {item.contentType === 'application/pdf' ? 'PDF' : 'Photo'}<span>{Math.ceil(item.size / 1024)} KB ↗</span></a></li>
    )}</ul> : <p className="text-sm text-muted-foreground">No evidence uploaded yet.</p>}
    {canUpload && <form className="space-y-3" onSubmit={event => {
      event.preventDefault();
      if (file) upload.mutate(file, { onSuccess: () => { setFile(null); setFileKey(key => key + 1); } });
    }}>
      <Label htmlFor="incident-evidence">Add evidence · JPEG, PNG or PDF · max 5 MB each, 10 files per case</Label>
      <Input key={fileKey} id="incident-evidence" type="file" accept="image/jpeg,image/png,application/pdf" disabled={upload.isPending} onChange={event => setFile(event.target.files?.[0] ?? null)} />
      <IncidentError error={upload.error} />
      {upload.isSuccess && <p role="status" className="text-sm text-primary">Evidence uploaded securely.</p>}
      <Button variant="outline" disabled={!file || upload.isPending || (incident.evidence?.length ?? 0) >= 10}>{upload.isPending ? 'Uploading…' : 'Upload evidence'}</Button>
    </form>}
  </section>;
}