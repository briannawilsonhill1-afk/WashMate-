import clsx from 'clsx';
import { CheckCircle2, Clock, PlayCircle, AlertCircle } from 'lucide-react';

type Status = 'pending' | 'accepted' | 'in_progress' | 'completed';

interface StatusBadgeProps {
  status: Status;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = {
    pending: {
      color: 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800',
      icon: Clock,
      label: 'Looking for Washer'
    },
    accepted: {
      color: 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800',
      icon: AlertCircle,
      label: 'Accepted'
    },
    in_progress: {
      color: 'bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/30 dark:text-purple-300 dark:border-purple-800',
      icon: PlayCircle,
      label: 'Washing'
    },
    completed: {
      color: 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800',
      icon: CheckCircle2,
      label: 'Clean & Ready'
    }
  };

  const { color, icon: Icon, label } = config[status];

  return (
    <span className={clsx(
      "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border",
      color,
      className
    )}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}
