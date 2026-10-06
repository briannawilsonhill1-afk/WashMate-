import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, buildUrl, type OrderInput } from '@shared/routes';
import { useToast } from '@/hooks/use-toast';

export function useOrders(filters?: { status?: string; enabled?: boolean }) {
  return useQuery({
    queryKey: [api.orders.list.path, filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.status) params.append('status', filters.status);

      const url = `${api.orders.list.path}${params.toString() ? `?${params.toString()}` : ''}`;
      const res = await fetch(url, { credentials: 'include' });

      if (!res.ok) throw new Error('Failed to fetch orders');
      const data = await res.json();
      return api.orders.list.responses[200].parse(data);
    },
    enabled: filters?.enabled !== false,
  });
}

export function useCreateOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: OrderInput) => {
      const res = await fetch(api.orders.create.path, {
        method: api.orders.create.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error('Failed to create order');
      return api.orders.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "Order Created!",
        description: "Your laundry pickup has been scheduled.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to create order. Please try again.",
        variant: "destructive",
      });
    }
  });
}

export function useCustomerAddress(orderId: number | undefined) {
  return useQuery({
    queryKey: ['/api/orders/customer-address', orderId],
    queryFn: async () => {
      if (!orderId) return null;
      const url = buildUrl(api.orders.customerAddress.path, { id: orderId });
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) return null;
      const data = await res.json();
      return api.orders.customerAddress.responses[200].parse(data);
    },
    enabled: !!orderId,
  });
}

export function useClaimOrder() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ orderId }: { orderId: number }) => {
      const url = buildUrl(api.orders.claim.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.claim.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to claim order');
      }
      return api.orders.claim.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });
      toast({
        title: "Job Claimed!",
        description: "You are now assigned to this laundry order.",
      });
    },
    onError: (error) => {
      toast({
        title: "Cannot Claim Job",
        description: error.message,
        variant: "destructive",
      });
    }
  });
}

export function useUpdateOrderStatus() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number; status: 'pending' | 'accepted' | 'in_progress' | 'completed' }) => {
      const url = buildUrl(api.orders.updateStatus.path, { id: orderId });
      const res = await fetch(url, {
        method: api.orders.updateStatus.method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed to update status');
      return api.orders.updateStatus.responses[200].parse(await res.json());
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: [api.orders.list.path] });

      const statusMessages = {
        accepted: "Order marked as accepted.",
        in_progress: "Laundry is now washing!",
        completed: "Job completed! Great work.",
        pending: "Order is pending."
      };

      toast({
        title: "Status Updated",
        description: statusMessages[variables.status],
      });
    }
  });
}
