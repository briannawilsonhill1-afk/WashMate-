import clsx from 'clsx';
import { CheckCircle2, Clock, PlayCircle, AlertCircle, Truck, PackageCheck } from 'lucide-react';

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'picked_up'
  | 'in_progress'
  | 'out_for_delivery'
  | 'completed';

interface StatusBadgeProps {
  status: OrderStatus;
  className?: string;
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Finding a washer',
  accepted: 'Washer assigned',
  picked_up: 'Laundry picked up',
  in_progress: 'Laundry being washed',
  out_for_delivery: 'On the way',
  completed: 'Delivered',
};

const CONFIG: Record<OrderStatus, { color: string; icon: typeof Clock; label: string }> = {
  pending: {
    color:
      'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
    icon: Clock,
    label: ORDER_STATUS_LABELS.pending,
  },
  accepted: {
    color:
      'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
    icon: AlertCircle,
    label: ORDER_STATUS_LABELS.accepted,
  },
  picked_up: {
    color:
      'bg-indigo-100 text-indigo-800 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-300 dark:border-indigo-800',
    icon: PackageCheck,
    label: ORDER_STATUS_LABELS.picked_up,
  },
  in_progress: {
    color:
      'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
    icon: PlayCircle,
    label: ORDER_STATUS_LABELS.in_progress,
  },
  out_for_delivery: {
    color:
      'bg-sky-100 text-sky-800 border-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-800',
    icon: Truck,
    label: ORDER_STATUS_LABELS.out_for_delivery,
  },
  completed: {
    color:
      'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
    icon: CheckCircle2,
    label: ORDER_STATUS_LABELS.completed,
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { color, icon: Icon, label } = CONFIG[status];

  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border',
        color,
        className,
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}
