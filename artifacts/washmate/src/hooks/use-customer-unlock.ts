import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { trackEvent } from '@/lib/analytics';

export const CUSTOMER_UNLOCK_QUERY_KEY = ['/api/customer-unlock'] as const;

export interface CustomerUnlockStatus {
  unlocked: boolean;
  amountCents: number;
  currency: string;
}

export type CustomerUnlockPayment =
  | { unlocked: true }
  | { clientSecret: string; publishableKey: string };

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
  return body?.message || body?.error || fallback;
}

export function useCustomerUnlock() {
  return useQuery({
    queryKey: CUSTOMER_UNLOCK_QUERY_KEY,
    queryFn: async (): Promise<CustomerUnlockStatus> => {
      const response = await fetch('/api/customer-unlock', { credentials: 'include' });
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not check your unlock status.'));
      }
      return response.json();
    },
    staleTime: 0,
    refetchOnMount: 'always',
  });
}

export function useStartCustomerUnlockPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<CustomerUnlockPayment> => {
      const response = await fetch('/api/customer-unlock/payment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        throw new Error(await readError(response, 'Could not start payment. Please try again.'));
      }
      return response.json();
    },
    onSuccess: (result) => {
      if ('clientSecret' in result) {
        trackEvent('unlock_checkout_started', { amount_cents: 299, currency: 'usd' });
      }
      if ('unlocked' in result && result.unlocked) {
        queryClient.invalidateQueries({ queryKey: CUSTOMER_UNLOCK_QUERY_KEY });
      }
    },
  });
}

export async function confirmCustomerUnlock(): Promise<{ unlocked: true }> {
  const response = await fetch('/api/customer-unlock/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({}),
  });
  if (!response.ok) {
    throw new Error(await readError(response, 'Payment is not confirmed yet. Please try again.'));
  }
  return response.json();
}