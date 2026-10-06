import { useAuth } from '@/hooks/use-auth';
import { LogOut, Droplets, Shield, CreditCard, Settings, ChartNoAxesCombined } from 'lucide-react';
import { motion } from 'framer-motion';
import { Link } from 'wouter';
import { useIncidentAccess } from '@/hooks/use-incidents';

export function Navbar() {
  const { user, logout } = useAuth();
  const access = useIncidentAccess();

  if (!user) return null;

  const displayName = user.firstName || user.email || 'Account';

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/20 bg-background/80 backdrop-blur-xl">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-2"
        >
          <div className="bg-primary/10 p-2 rounded-xl text-primary">
            <Droplets className="w-6 h-6" />
          </div>
          <span className="font-display font-bold text-xl text-foreground tracking-tight">
            Wash<span className="text-primary">Mate</span>
          </span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-1 sm:gap-4"
        >
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-sm font-semibold text-foreground" data-testid="text-username">{displayName}</span>
            {user.role && (
              <span className="text-xs text-muted-foreground capitalize">{user.role} Account</span>
            )}
          </div>

          <div className="h-8 w-px bg-border hidden sm:block"></div>

          {user.role === 'washer' && (
            <Link href="/washer/profile">
              <span className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer" data-testid="link-washer-profile">
                <CreditCard className="w-4 h-4" />
                <span className="hidden sm:inline">Profile</span>
              </span>
            </Link>
          )}

          <Link href="/settings">
            <span className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer" data-testid="link-settings">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </span>
          </Link>

          <Link href="/incidents" className="px-2 py-2 rounded-lg text-xs sm:text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary" data-testid="link-incidents">Reports</Link>
          {access.data?.isAdmin && <Link href="/admin/incidents" className="px-2 py-2 rounded-lg text-xs sm:text-sm font-medium text-primary hover:bg-secondary" data-testid="link-admin-incidents">Review</Link>}
          {access.data?.isAdmin && <Link href="/admin/revenue" className="flex items-center gap-2 px-2 py-2 rounded-lg text-xs sm:text-sm font-medium text-primary hover:bg-secondary" data-testid="link-admin-revenue"><ChartNoAxesCombined className="h-4 w-4" /><span className="hidden sm:inline">Revenue</span></Link>}
          <Link href="/privacy">
            <span className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors cursor-pointer" data-testid="link-privacy">
              <Shield className="w-4 h-4" />
              <span className="hidden sm:inline">Privacy</span>
            </span>
          </Link>

          <button
            onClick={() => logout()}
            data-testid="button-logout"
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          >
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        </motion.div>
      </div>
    </nav>
  );
}
