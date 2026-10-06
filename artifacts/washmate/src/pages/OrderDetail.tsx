import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, Shirt, Folders, PawPrint, AlertTriangle, Droplets, Clock } from 'lucide-react';
import { format } from 'date-fns';
import { api } from '@/lib/api';
import type { Order } from '@/lib/api';
import { ORDER_STATUS_LABELS, StatusBadge, type OrderStatus } from '@/components/ui/StatusBadge';
import { useAuth } from '@/hooks/use-auth';
import { OrderIncidentReport } from '@/components/IncidentSupport';

const LOAD_SIZE_LABELS: Record<string, string> = {
  small: '1 Bag (Small)',
  medium: '2 Bags (Medium)',
  large: '3+ Bags (Large)',
};

const TIMELINE: { status: OrderStatus; label: string }[] = [
  { status: 'pending', label: ORDER_STATUS_LABELS.pending },
  { status: 'accepted', label: ORDER_STATUS_LABELS.accepted },
  { status: 'picked_up', label: ORDER_STATUS_LABELS.picked_up },
  { status: 'in_progress', label: ORDER_STATUS_LABELS.in_progress },
  { status: 'out_for_delivery', label: ORDER_STATUS_LABELS.out_for_delivery },
  { status: 'completed', label: ORDER_STATUS_LABELS.completed },
];

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const { user, isAuthenticated } = useAuth();
  const orderId = Number(id);

  const { data: orders, isLoading } = useQuery({
    queryKey: [api.orders.list.path],
    queryFn: async () => {
      const res = await fetch(api.orders.list.path, { credentials: 'include' });
      if (!res.ok) throw new Error('Failed to fetch orders');
      return api.orders.list.responses[200].parse(await res.json());
    },
    enabled: isAuthenticated,
    refetchInterval: (query) => {
      if (user?.role !== 'customer') return false;
      const currentOrder = query.state.data?.find((item) => item.id === orderId);
      return currentOrder && currentOrder.status !== 'completed' ? 15_000 : false;
    },
    refetchIntervalInBackground: false,
  });

  const order = useMemo(
    () => orders?.find((o) => o.id === orderId) as Order | undefined,
    [orders, orderId],
  );

  const backHref = user?.role === 'washer' ? '/washer' : '/customer';

  if (!isAuthenticated) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-8">
        <div className="h-32 bg-secondary animate-pulse rounded-2xl" />
      </div>
    );
  }

  if (!order) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center">
        <h1 className="text-2xl font-display font-bold text-foreground">Order not found</h1>
        <p className="text-muted-foreground mt-2">
          This order may have been removed or doesn't belong to your account.
        </p>
        <Link href={backHref}>
          <span className="inline-flex items-center gap-2 mt-6 px-5 py-3 rounded-xl bg-primary text-primary-foreground font-bold cursor-pointer">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </span>
        </Link>
      </div>
    );
  }

  const completedIdx = TIMELINE.findIndex((t) => t.status === order.status);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {user?.role === 'customer' && String(order.customerId) === String(user.id) && order.washerId && <OrderIncidentReport orderId={order.id} />}
      <Link href={backHref}>
        <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to dashboard
        </span>
      </Link>

      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Order #{order.id}</h1>
            {order.createdAt && (
              <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Placed {format(new Date(order.createdAt as Date), 'MMM d, yyyy - h:mm a')}
              </p>
            )}
          </div>
          <StatusBadge status={order.status as OrderStatus} />
        </div>

        <div className="mt-6 grid sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-xl bg-secondary/50">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              Load
            </div>
            <div className="mt-1 font-bold text-foreground flex items-center gap-2">
              <Shirt className="w-4 h-4" />
              {LOAD_SIZE_LABELS[order.loadSize] ?? order.loadSize}
            </div>
          </div>
          <div className="p-4 rounded-xl bg-secondary/50">
            <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
              Total
            </div>
            <div className="mt-1 font-display text-2xl font-bold text-foreground">
              ${order.totalFee}
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {order.extraFolding && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-primary/10 text-primary px-2.5 py-1 rounded-lg">
              <Folders className="w-3.5 h-3.5" /> Premium folding
            </span>
          )}
          {order.hasPetHair && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 px-2.5 py-1 rounded-lg">
              <PawPrint className="w-3.5 h-3.5" /> Pet hair
            </span>
          )}
          {order.heavilySoiled && (
            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 px-2.5 py-1 rounded-lg">
              <AlertTriangle className="w-3.5 h-3.5" /> Heavily soiled
            </span>
          )}
          <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 px-2.5 py-1 rounded-lg">
            <Droplets className="w-3.5 h-3.5" />
            {order.soapPreference === 'customer_provided' ? 'Customer soap' : 'Washer soap'}
          </span>
        </div>

        <h2 className="mt-8 text-lg font-bold text-foreground">Progress</h2>
        <ol className="mt-4 space-y-3">
          {TIMELINE.map((step, idx) => {
            const reached = completedIdx >= idx;
            const current = completedIdx === idx;
            return (
              <li key={step.status} className="flex items-center gap-3">
                <div
                  className={
                    reached
                      ? current
                        ? 'w-3 h-3 rounded-full bg-primary ring-4 ring-primary/20'
                        : 'w-3 h-3 rounded-full bg-primary'
                      : 'w-3 h-3 rounded-full bg-border'
                  }
                />
                <span
                  className={
                    reached ? 'text-foreground font-medium' : 'text-muted-foreground'
                  }
                >
                  {step.label}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
