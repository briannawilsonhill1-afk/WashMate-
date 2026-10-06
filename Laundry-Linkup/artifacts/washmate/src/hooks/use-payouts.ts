import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useEarnings(enabled: boolean = true) {
  return useQuery({
    queryKey: [api.washerProfile.earnings.path],
    queryFn: async () => {
      const res = await fetch(api.washerProfile.earnings.path, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch earnings');
      return api.washerProfile.earnings.responses[200].parse(await res.json());
    },
    enabled,
  });
}

export function useRequestPayout() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.washerProfile.requestPayout.path, {
        method: api.washerProfile.requestPayout.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to request payout');
      }
      return api.washerProfile.requestPayout.responses[201].parse(await res.json());
    },
    onSuccess: (payout) => {
      queryClient.invalidateQueries({ queryKey: [api.washerProfile.earnings.path] });
      toast({
        title: 'Payout requested',
        description: `$${(payout.amountCents / 100).toFixed(2)} for ${payout.orderCount} order${payout.orderCount === 1 ? '' : 's'} is now pending settlement.`,
      });
    },
    onError: (err) => {
      toast({
        title: 'Payout not started',
        description: err.message,
        variant: 'destructive',
      });
    }
  });
}
