import { useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { useOrders, useClaimOrder, useUpdateOrderStatus, useCustomerAddress } from '@/hooks/use-orders';
import { useQuery } from '@tanstack/react-query';
import { api, buildUrl } from '@shared/routes';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { MapPin, ArrowRight, CheckCircle, Waves, Shirt, Navigation, ShieldAlert, PawPrint, AlertTriangle, Droplets } from 'lucide-react';
import { Link } from 'wouter';
import { format } from 'date-fns';
import clsx from 'clsx';

const LOAD_SIZE_LABELS: Record<string, string> = {
  small: '1 Bag (Small)',
  medium: '2 Bags (Medium)',
  large: '3+ Bags (Large)',
};

function PickupAddress({ orderId }: { orderId: number }) {
  const { data, isLoading } = useCustomerAddress(orderId);

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="w-4 h-4 animate-pulse" />
        <span>Loading address...</span>
      </div>
    );
  }

  if (!data?.address) return null;

  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(data.address)}`;

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mt-3 p-3 bg-secondary/50 rounded-xl">
      <div className="flex items-start gap-2 flex-1 min-w-0">
        <MapPin className="w-4 h-4 text-primary shrink-0 mt-0.5" />
        <span className="text-sm text-foreground font-medium truncate" data-testid={`text-pickup-address-${orderId}`}>
          {data.address}
        </span>
      </div>
      <a
        href={mapsUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-bold bg-primary text-white hover:bg-primary/90 transition-colors shadow-sm shrink-0"
        data-testid={`link-directions-${orderId}`}
      >
        <Navigation className="w-4 h-4" />
        Get Directions
      </a>
    </div>
  );
}

export default function WasherDashboard() {
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<'available' | 'my_jobs'>('available');

  const { data: washerProfile } = useQuery({
    queryKey: ['/api/washer-profile/status'],
    queryFn: async () => {
      const res = await fetch(api.washerProfile.status.path, { credentials: 'include' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to fetch washer status');
      return res.json();
    },
    enabled: !!user,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.bgCheckStatus === 'pending') return 3000;
      return false;
    },
  });

  const isCleared = washerProfile?.bgCheckStatus === 'cleared';

  const { data: availableOrders, isLoading: isLoadingAvailable } = useOrders({ status: 'pending', enabled: isCleared });
  const { data: myOrders, isLoading: isLoadingMine } = useOrders();

  const claimOrder = useClaimOrder();
  const updateStatus = useUpdateOrderStatus();

  const handleClaim = (orderId: number) => {
    if (!user) return;
    claimOrder.mutate({ orderId });
  };

  const handleProgress = (orderId: number, currentStatus: string) => {
    let nextStatus: 'pending' | 'accepted' | 'in_progress' | 'completed' = 'pending';
    if (currentStatus === 'accepted') nextStatus = 'in_progress';
    if (currentStatus === 'in_progress') nextStatus = 'completed';
    
    if (nextStatus !== 'pending') {
      updateStatus.mutate({ orderId, status: nextStatus });
    }
  };

  const activeMyOrders = myOrders?.filter(o => o.status !== 'completed' && o.status !== 'pending') || [];
  const completedOrders = myOrders?.filter(o => o.status === 'completed') || [];

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <header className="mb-10">
        <h1 className="text-3xl font-display font-bold text-foreground">Washer Portal</h1>
        <p className="text-muted-foreground mt-1">Find jobs, manage your active washes, and earn.</p>
      </header>

      {!isCleared && (
        <div className="mb-8 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-2xl p-5" data-testid="banner-bg-check">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-6 h-6 text-amber-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-display font-bold text-amber-800 dark:text-amber-200">
                {washerProfile?.bgCheckStatus === 'pending' ? 'Background Check In Progress' : 'Background Check Required'}
              </h3>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                {washerProfile?.bgCheckStatus === 'pending'
                  ? 'Your background check is being processed. You will be able to claim jobs once it clears. This page will update automatically.'
                  : 'You must complete a background check verification before you can claim any jobs. This is required to ensure the safety of our customers.'
                }
              </p>
              {washerProfile?.bgCheckStatus !== 'pending' && (
                <Link href="/washer/profile">
                  <span className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg bg-amber-600 text-white text-sm font-bold hover:bg-amber-700 transition-colors cursor-pointer" data-testid="link-complete-verification">
                    Complete Verification
                  </span>
                </Link>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Custom Tabs */}
      <div className="flex space-x-1 bg-secondary/50 p-1 rounded-xl mb-8 w-fit">
        <button
          onClick={() => setActiveTab('available')}
          className={clsx(
            "px-6 py-2.5 text-sm font-bold rounded-lg transition-all",
            activeTab === 'available' ? "bg-white dark:bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          Available Jobs
          {availableOrders && availableOrders.length > 0 && (
            <span className="ml-2 bg-primary text-white text-[10px] px-2 py-0.5 rounded-full">{availableOrders.length}</span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('my_jobs')}
          className={clsx(
            "px-6 py-2.5 text-sm font-bold rounded-lg transition-all",
            activeTab === 'my_jobs' ? "bg-white dark:bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
          )}
        >
          My Active Washes
          {activeMyOrders.length > 0 && (
            <span className="ml-2 bg-blue-500 text-white text-[10px] px-2 py-0.5 rounded-full">{activeMyOrders.length}</span>
          )}
        </button>
      </div>

      {activeTab === 'available' && (
        <div className="space-y-4">
          <h2 className="text-xl font-bold text-foreground flex items-center gap-2">
            <Waves className="w-5 h-5 text-primary" /> 
            Job Board
          </h2>
          
          {!isCleared ? (
            <div className="text-center py-16 glass-card rounded-3xl" data-testid="banner-job-board-locked">
              <div className="w-16 h-16 bg-amber-100 dark:bg-amber-900/30 text-amber-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">Verification Required</h3>
              <p className="text-muted-foreground mt-2 max-w-sm mx-auto">Complete your background check to browse and claim available jobs.</p>
            </div>
          ) : isLoadingAvailable ? (
             <div className="grid md:grid-cols-2 gap-4">
               {[1, 2].map(i => <div key={i} className="h-40 bg-secondary animate-pulse rounded-2xl" />)}
             </div>
          ) : availableOrders?.length === 0 ? (
            <div className="text-center py-16 glass-card rounded-3xl">
              <div className="w-16 h-16 bg-muted text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-4">
                <Shirt className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-foreground">No jobs right now</h3>
              <p className="text-muted-foreground mt-2">Check back later for new laundry requests in your area.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {availableOrders?.map((order, idx) => (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: idx * 0.05 }}
                  key={order.id}
                  className="glass-card rounded-2xl p-6 flex flex-col justify-between hover-lift border-t-4 border-t-primary"
                >
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <span className="font-bold text-sm text-muted-foreground">Order #{order.id}</span>
                      <div className="text-xl font-display font-bold text-primary">${order.totalFee}</div>
                    </div>
                    
                    <div className="space-y-3 mb-6">
                      <div className="flex items-start gap-3">
                        <Shirt className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <p className="font-semibold text-foreground">{LOAD_SIZE_LABELS[order.loadSize] ?? order.loadSize}</p>
                          {order.extraFolding && <p className="text-xs text-primary font-bold mt-0.5">+ Premium Folding Included</p>}
                        </div>
                      </div>
                      {(order.hasPetHair || order.heavilySoiled) && (
                        <div className="flex flex-wrap gap-2">
                          {order.hasPetHair && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-lg" data-testid={`badge-pet-hair-${order.id}`}>
                              <PawPrint className="w-3.5 h-3.5" />
                              Pet Hair
                            </span>
                          )}
                          {order.heavilySoiled && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2.5 py-1 rounded-lg" data-testid={`badge-soiled-${order.id}`}>
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Heavily Soiled
                            </span>
                          )}
                        </div>
                      )}
                      {('soilNotes' in order && order.soilNotes) && (
                        <p className="text-xs text-muted-foreground italic bg-secondary/50 px-3 py-2 rounded-lg" data-testid={`text-soil-notes-${order.id}`}>
                          Note: {order.soilNotes}
                        </p>
                      )}
                      <div className="flex items-start gap-3">
                        <Droplets className="w-4 h-4 text-muted-foreground shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-foreground" data-testid={`text-soap-${order.id}`}>
                            {order.soapPreference === 'customer_provided' ? 'Customer providing soap' : 'You provide soap'}
                          </p>
                          {order.soapPreference === 'washer_provided' && (
                            <p className="text-xs text-primary font-bold">Must be hypoallergenic</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-start gap-3">
                        <MapPin className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
                        <p className="text-sm font-medium text-foreground">Customer Location (Hidden until claimed)</p>
                      </div>
                    </div>
                  </div>
                  
                  <button
                    onClick={() => handleClaim(order.id)}
                    disabled={claimOrder.isPending || !isCleared}
                    className="w-full py-3 rounded-xl font-bold bg-primary/10 text-primary hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-primary/10 disabled:hover:text-primary"
                  >
                    {!isCleared ? 'Verification Required' : 'Claim Job'}
                  </button>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'my_jobs' && (
        <div className="space-y-12">
          {/* Active Jobs */}
          <div>
            <h2 className="text-xl font-bold text-foreground mb-4">Currently Working On</h2>
            {isLoadingMine ? (
              <div className="h-32 bg-secondary animate-pulse rounded-2xl" />
            ) : activeMyOrders.length === 0 ? (
              <div className="p-8 border-2 border-dashed border-border rounded-2xl text-center">
                <p className="text-muted-foreground font-medium">You don't have any active jobs. Go claim one from the board!</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {activeMyOrders.map((order) => (
                  <div key={order.id} className="glass-card p-6 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 border border-primary/20">
                    <div className="flex-1 w-full">
                      <div className="flex items-center justify-between md:justify-start gap-4 mb-2">
                        <h3 className="font-bold text-lg">Order #{order.id}</h3>
                        <StatusBadge status={order.status as any} />
                      </div>
                      <p className="text-muted-foreground text-sm flex gap-4 flex-wrap">
                        <span>{LOAD_SIZE_LABELS[order.loadSize] ?? order.loadSize}</span>
                        {order.extraFolding && <span className="text-primary font-medium">Folding req.</span>}
                        <span className="font-bold text-foreground">${order.totalFee}</span>
                      </p>
                      {(order.hasPetHair || order.heavilySoiled) && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {order.hasPetHair && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-2.5 py-1 rounded-lg">
                              <PawPrint className="w-3.5 h-3.5" />
                              Pet Hair
                            </span>
                          )}
                          {order.heavilySoiled && (
                            <span className="inline-flex items-center gap-1.5 text-xs font-bold bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 px-2.5 py-1 rounded-lg">
                              <AlertTriangle className="w-3.5 h-3.5" />
                              Heavily Soiled
                            </span>
                          )}
                        </div>
                      )}
                      {('soilNotes' in order && order.soilNotes) && (
                        <p className="text-xs text-muted-foreground italic mt-1">Note: {order.soilNotes}</p>
                      )}
                      <p className="text-xs mt-1 flex items-center gap-1">
                        <Droplets className="w-3 h-3" />
                        <span className={order.soapPreference === 'washer_provided' ? 'text-primary font-bold' : 'text-muted-foreground'}>
                          {order.soapPreference === 'customer_provided' ? 'Customer providing soap' : 'You provide soap (hypoallergenic)'}
                        </span>
                      </p>
                      {order.washerId && (
                        <PickupAddress orderId={order.id} />
                      )}
                    </div>

                    <div className="w-full md:w-auto flex flex-col sm:flex-row gap-3">
                      {order.status === 'accepted' && (
                        <button
                          onClick={() => handleProgress(order.id, order.status)}
                          disabled={updateStatus.isPending}
                          className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-purple-600 text-white hover:bg-purple-700 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-purple-600/20"
                        >
                          Start Washing <ArrowRight className="w-4 h-4" />
                        </button>
                      )}
                      {order.status === 'in_progress' && (
                        <button
                          onClick={() => handleProgress(order.id, order.status)}
                          disabled={updateStatus.isPending}
                          className="flex-1 md:flex-none px-6 py-3 rounded-xl font-bold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20"
                        >
                          Mark Complete <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* History */}
          {completedOrders.length > 0 && (
            <div>
              <h2 className="text-xl font-bold text-foreground mb-4 opacity-70">Completed History</h2>
              <div className="grid md:grid-cols-2 gap-4 opacity-70">
                {completedOrders.map(order => (
                  <div key={order.id} className="bg-secondary p-4 rounded-xl flex justify-between items-center">
                    <div>
                      <span className="font-bold text-sm">Order #{order.id}</span>
                      <p className="text-xs text-muted-foreground mt-1">Earned ${order.totalFee}</p>
                    </div>
                    <StatusBadge status="completed" className="bg-transparent border-none scale-90" />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
