import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from './use-auth';

export interface IncidentAccess {
  isAdmin: boolean;
  approvedIncidentCount: number;
  workBlocked: boolean;
  outstandingFeeCents: number;
}
export interface Incident {
  id: number;
  orderId: number;
  customerId: string;
  washerId: string;
  category: 'missing' | 'damaged' | 'sentimental' | 'valuable';
  description: string;
  status: 'submitted' | 'approved' | 'rejected';
  washerResponse: string | null;
  reviewNote: string | null;
  reimbursementCents: number;
  reimbursementStatus: 'none' | 'pending' | 'paid' | 'failed';
  createdAt: string;
  evidence?: { id: number; downloadPath: string; contentType: string; size: number }[];
}
export interface ReimbursementAccount {
  accountId: string | null;
  ready: boolean;
  payoutsEnabled: boolean;
  transfersActive: boolean;
}

export async function incidentRequest<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    credentials: 'include',
    ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.error || 'Unable to complete this request. Please try again.');
  }
  return response.json();
}

export function useIncidentAccess() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['/api/incidents/access', user?.id],
    queryFn: () => incidentRequest<IncidentAccess>('/api/incidents/access'),
    enabled: !!user,
    refetchInterval: 30_000,
  });
}

export function useIncidentMutation<T, V>(action: (value: V) => Promise<T>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: action,
    onSuccess: () => {
      void client.invalidateQueries({ predicate: ({ queryKey }) => {
        const key = String(queryKey[0]);
        return key.includes('incidents') || key.includes('orders') || key.includes('earnings') || key.includes('payout');
      } });
    },
  });
}

export const money = (cents: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100);