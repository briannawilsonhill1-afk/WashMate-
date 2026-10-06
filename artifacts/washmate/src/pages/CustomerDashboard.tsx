import { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { CustomerUnlockRequiredError, useOrders, useCreateOrder } from '@/hooks/use-orders';
import { useCustomerUnlock, confirmCustomerUnlock } from '@/hooks/use-customer-unlock';
import { CustomerUnlockDialog } from '@/components/CustomerUnlockDialog';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Plus, Info, Shirt, Folders, PawPrint, AlertTriangle, Droplets, ShieldCheck, Truck, CheckCircle2 } from 'lucide-react';
import { format } from 'date-fns';

const LOAD_SIZES = [
  { id: 'small' as const, label: '1 Bag (Small)', fee: 25, desc: 'Approx 1-2 loads' },
  { id: 'medium' as const, label: '2 Bags (Medium)', fee: 35, desc: 'Approx 3-4 loads' },
  { id: 'large' as const, label: '3+ Bags (Large)', fee: 45, desc: 'Approx 5+ loads' },
];

export default function CustomerDashboard() {
  const { user } = useAuth();
  const { data: orders, isLoading } = useOrders({ pollWhileActive: true });
  const createOrder = useCreateOrder();
  const unlockStatus = useCustomerUnlock();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isUnlockOpen, setIsUnlockOpen] = useState(false);
  const [isReconcilingPayment, setIsReconcilingPayment] = useState(false);
  const [returnMessage, setReturnMessage] = useState<string | null>(null);
  const [loadSize, setLoadSize] = useState(LOAD_SIZES[1]);
  const [extraFolding, setExtraFolding] = useState(false);
  const [hasPetHair, setHasPetHair] = useState(false);
  const [heavilySoiled, setHeavilySoiled] = useState(false);
  const [soilNotes, setSoilNotes] = useState('');
  const [soapPreference, setSoapPreference] = useState<'customer_provided' | 'washer_provided'>('washer_provided');
  const [recurringInterval, setRecurringInterval] = useState<'none' | 'weekly' | 'biweekly' | 'monthly'>('none');

  const soiledFee = heavilySoiled ? 15 : 0;
  const totalFee = loadSize.fee + (extraFolding ? 10 : 0) + soiledFee;

  const openOrderFlow = async () => {
    setReturnMessage(null);
    let status = unlockStatus.data;
    if (!status) {
      const result = await unlockStatus.refetch();
      status = result.data;
      if (!status) {
        setReturnMessage(result.error?.message || 'Could not check your unlock status. Please try again.');
        return;
      }
    }
    if (status.unlocked) {
      setIsModalOpen(true);
    } else {
      setIsUnlockOpen(true);
    }
  };

  const refreshUnlockStatus = useCallback(async () => {
    const result = await unlockStatus.refetch();
    return result.data?.unlocked === true;
  }, [unlockStatus.refetch]);

  const handleUnlocked = useCallback(() => {
    setIsUnlockOpen(false);
    setReturnMessage(null);
    setIsModalOpen(true);
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('customer_unlock_return') !== '1') return;

    let active = true;
    setIsReconcilingPayment(true);
    setReturnMessage('Checking your payment…');
    confirmCustomerUnlock()
      .then(async () => {
        const result = await unlockStatus.refetch();
        if (!active) return;
        if (result.data?.unlocked) {
          params.delete('customer_unlock_return');
          params.delete('payment_intent');
          params.delete('payment_intent_client_secret');
          params.delete('redirect_status');
          const query = params.toString();
          window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
          setReturnMessage(null);
          setIsModalOpen(true);
        } else {
          setReturnMessage('Your payment is still processing. Open the pickup flow to check again.');
        }
      })
      .catch((error) => {
        if (active) setReturnMessage(error instanceof Error ? error.message : 'Could not verify payment yet.');
      })
      .finally(() => {
        if (active) setIsReconcilingPayment(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    createOrder.mutate({
      loadSize: loadSize.id,
      extraFolding,
      hasPetHair,
      heavilySoiled,
      soilNotes: soilNotes || undefined,
      soapPreference,
      recurringInterval,
    }, {
      onSuccess: () => {
        setIsModalOpen(false);
        setLoadSize(LOAD_SIZES[1]);
        setExtraFolding(false);
        setHasPetHair(false);
        setHeavilySoiled(false);
        setSoilNotes('');
        setSoapPreference('washer_provided');
        setRecurringInterval('none');
      },
      onError: (error) => {
        if (error instanceof CustomerUnlockRequiredError) {
          unlockStatus.refetch();
          setIsUnlockOpen(true);
        }
      }
    });
  };

  return (
    <div className="max-w-5xl mx-auto px-4 py-8">
      <header className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-10">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">My Laundry</h1>
          <p className="text-muted-foreground mt-1">Manage your pickups and deliveries.</p>
        </div>
        <button
          onClick={openOrderFlow}
          disabled={unlockStatus.isLoading || isReconcilingPayment}
          className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
          data-testid="button-request-pickup"
        >
          <Plus className="w-5 h-5" />
          {isReconcilingPayment ? 'Checking payment…' : 'Request Pickup'}
        </button>
      </header>

      {returnMessage && (
        <div className="mb-6 p-4 rounded-2xl border border-amber-300 bg-amber-50 text-sm text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3" role="status" data-testid="status-unlock-return">
          <span>{returnMessage}</span>
          {!isReconcilingPayment && (
            <button
              type="button"
              onClick={openOrderFlow}
              className="shrink-0 px-4 py-2 rounded-lg font-bold bg-amber-900 text-amber-50 dark:bg-amber-200 dark:text-amber-950"
              data-testid="button-retry-unlock-status"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {/* Privacy reassurance */}
      <div className="mb-6 p-4 rounded-2xl border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/60 dark:bg-emerald-950/20 flex items-start gap-3" data-testid="banner-address-privacy">
        <ShieldCheck className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        <div className="text-sm text-emerald-900 dark:text-emerald-200">
          <span className="font-bold">Your address stays private.</span>{' '}
          Browsing washers only see your neighborhood. Your full pickup address is shared with one assigned washer whose background screening has been cleared, and only while your order is in progress.
        </div>
      </div>

      {/* Orders List */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-foreground mb-4">Recent Orders</h2>
        
        {isLoading ? (
          <div className="grid gap-4">
            {[1, 2, 3].map(i => (
              <div key={i} className="h-24 bg-secondary animate-pulse rounded-2xl" />
            ))}
          </div>
        ) : orders?.length === 0 ? (
          <div className="text-center py-16 glass-card rounded-3xl">
            <div className="w-16 h-16 bg-primary/10 text-primary rounded-full flex items-center justify-center mx-auto mb-4">
              <Shirt className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-foreground">No orders yet</h3>
            <p className="text-muted-foreground mt-2">Your laundry basket is empty. Request a pickup to get started!</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {orders?.map((order, idx) => (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.05 }}
                key={order.id}
                className="glass-card p-5 sm:p-6 rounded-2xl flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center hover-lift"
              >
                <div>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="font-bold text-lg text-foreground">Order #{order.id}</span>
                    <StatusBadge status={order.status as any} />
                  </div>
                  <p className="text-muted-foreground text-sm flex items-center gap-2 flex-wrap">
                    <Shirt className="w-4 h-4" /> {LOAD_SIZES.find(s => s.id === order.loadSize)?.label ?? order.loadSize}
                    {order.extraFolding && (
                      <>
                        <span className="text-border">•</span>
                        <Folders className="w-4 h-4" /> + Folding
                      </>
                    )}
                    {order.hasPetHair && (
                      <>
                        <span className="text-border">•</span>
                        <span className="text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <PawPrint className="w-3 h-3" /> Pet Hair
                        </span>
                      </>
                    )}
                    {order.heavilySoiled && (
                      <>
                        <span className="text-border">•</span>
                        <span className="text-xs font-medium bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Heavily Soiled +${order.soiledFee}
                        </span>
                      </>
                    )}
                    <span className="text-border">•</span>
                    <span className="text-xs font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Droplets className="w-3 h-3" />
                      {order.soapPreference === 'customer_provided' ? 'My Soap' : 'Washer Soap'}
                    </span>
                    {('recurringInterval' in order && order.recurringInterval !== 'none') && (
                      <>
                        <span className="text-border">•</span>
                        <span className="text-xs font-medium bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 px-1.5 py-0.5 rounded flex items-center gap-1">
                          <Plus className="w-3 h-3 rotate-45" /> {order.recurringInterval}
                        </span>
                      </>
                    )}
                  </p>
                  {('createdAt' in order && order.createdAt) && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Requested on {format(new Date(order.createdAt as Date), 'MMM d, yyyy - h:mm a')}
                    </p>
                  )}
                   {order.status === 'out_for_delivery' && (
                     <div
                       className="mt-4 flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900 dark:border-sky-800 dark:bg-sky-950/30 dark:text-sky-200"
                       role="status"
                       data-testid={`message-on-the-way-${order.id}`}
                     >
                       <Truck className="mt-0.5 h-5 w-5 shrink-0" />
                       <div>
                         <p className="font-bold">Your laundry is on the way</p>
                         <p className="text-sm">Your washer is en route for drop-off.</p>
                       </div>
                     </div>
                   )}
                   {order.status === 'completed' && (
                     <div
                       className="mt-4 flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200"
                       role="status"
                       data-testid={`message-delivered-${order.id}`}
                     >
                       <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
                       <div>
                         <p className="font-bold">Delivered</p>
                         <p className="text-sm">Your clean laundry has been dropped off.</p>
                       </div>
                     </div>
                   )}
                </div>
                <div className="text-right">
                  <div className="text-2xl font-display font-bold text-foreground">${order.totalFee}</div>
                  <div className="text-xs text-muted-foreground mt-1 font-medium bg-secondary px-2 py-1 rounded-md inline-block">Flat Rate</div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-lg bg-card rounded-3xl shadow-2xl border border-border overflow-hidden"
          >
            <div className="p-6 border-b border-border">
              <h2 className="text-2xl font-display font-bold text-foreground">Schedule Pickup</h2>
              <p className="text-muted-foreground text-sm mt-1">We'll pick it up from: <span className="font-semibold text-foreground">{user?.address}</span></p>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              <div>
                <label className="block text-sm font-bold text-foreground mb-3">Estimated Load Size</label>
                <div className="grid gap-3">
                  {LOAD_SIZES.map((size) => (
                    <div 
                      key={size.id}
                      onClick={() => setLoadSize(size)}
                      className={`cursor-pointer p-4 rounded-xl border-2 transition-all flex justify-between items-center ${loadSize.id === size.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}
                    >
                      <div>
                        <div className={`font-bold ${loadSize.id === size.id ? 'text-primary' : 'text-foreground'}`}>{size.label}</div>
                        <div className="text-xs text-muted-foreground mt-1">{size.desc}</div>
                      </div>
                      <div className="font-display font-bold text-lg">${size.fee}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 rounded-xl border border-border bg-secondary/50 flex items-start gap-4">
                <div className="pt-1">
                  <input
                    type="checkbox"
                    id="folding"
                    checked={extraFolding}
                    onChange={(e) => setExtraFolding(e.target.checked)}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
                  />
                </div>
                <label htmlFor="folding" className="cursor-pointer flex-1">
                  <div className="font-bold text-foreground">Add Premium Folding</div>
                  <div className="text-sm text-muted-foreground mt-1">Everything returned perfectly folded and ready for the drawer.</div>
                </label>
                <div className="font-bold text-primary">+$10</div>
              </div>

              <div className="p-4 rounded-xl border border-border bg-secondary/50 flex items-start gap-4">
                <div className="pt-1">
                  <input
                    type="checkbox"
                    id="petHair"
                    checked={hasPetHair}
                    onChange={(e) => setHasPetHair(e.target.checked)}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
                    data-testid="checkbox-pet-hair"
                  />
                </div>
                <label htmlFor="petHair" className="cursor-pointer flex-1">
                  <div className="font-bold text-foreground flex items-center gap-2">
                    <PawPrint className="w-4 h-4 text-amber-500" />
                    Pet Hair Present
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Let the washer know your laundry may contain pet hair so they can prepare accordingly.</div>
                </label>
              </div>

              <div className={`p-4 rounded-xl border bg-secondary/50 flex items-start gap-4 ${heavilySoiled ? 'border-amber-300 bg-amber-50/50 dark:bg-amber-950/20' : 'border-border'}`}>
                <div className="pt-1">
                  <input
                    type="checkbox"
                    id="heavilySoiled"
                    checked={heavilySoiled}
                    onChange={(e) => setHeavilySoiled(e.target.checked)}
                    className="w-5 h-5 rounded border-border text-primary focus:ring-primary"
                    data-testid="checkbox-heavily-soiled"
                  />
                </div>
                <label htmlFor="heavilySoiled" className="cursor-pointer flex-1">
                  <div className="font-bold text-foreground flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500" />
                    Heavily Soiled Laundry
                  </div>
                  <div className="text-sm text-muted-foreground mt-1">Items with heavy stains, mud, grease, food, or other significant soiling that require extra attention.</div>
                </label>
                <div className="font-bold text-primary">+$15</div>
              </div>

              {(hasPetHair || heavilySoiled) && (
                <div>
                  <label className="block text-sm font-bold text-foreground mb-2">
                    Additional Notes for the Washer
                  </label>
                  <textarea
                    value={soilNotes}
                    onChange={(e) => setSoilNotes(e.target.value)}
                    placeholder={hasPetHair && heavilySoiled
                      ? "e.g. Dog hair on blankets, mud stains on work clothes..."
                      : hasPetHair
                      ? "e.g. Cat hair on sweaters, dog hair on bedding..."
                      : "e.g. Grease stains on shirts, mud on jeans..."}
                    rows={2}
                    className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none text-sm"
                    data-testid="textarea-soil-notes"
                  />
                </div>
              )}

              <div>
                <label className="block text-sm font-bold text-foreground mb-3 flex items-center gap-2">
                  <Droplets className="w-4 h-4 text-primary" />
                  Detergent / Soap
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setSoapPreference('washer_provided')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      soapPreference === 'washer_provided'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                    data-testid="button-soap-washer"
                  >
                    <div className={`font-bold text-sm ${soapPreference === 'washer_provided' ? 'text-primary' : 'text-foreground'}`}>
                      Washer Provides
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Hypoallergenic soap only</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => setSoapPreference('customer_provided')}
                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                      soapPreference === 'customer_provided'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:border-primary/30'
                    }`}
                    data-testid="button-soap-customer"
                  >
                    <div className={`font-bold text-sm ${soapPreference === 'customer_provided' ? 'text-primary' : 'text-foreground'}`}>
                      I'll Provide My Own
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Include with your laundry</div>
                  </button>
                </div>
                {soapPreference === 'washer_provided' && (
                  <p className="text-xs text-primary font-medium mt-2 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    All washer-supplied detergent must be hypoallergenic per WashMate policy.
                  </p>
                )}
                {soapPreference === 'customer_provided' && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Please include your detergent with your laundry bag at pickup.
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-bold text-foreground mb-3">Schedule Routine Pickup</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(['none', 'weekly', 'biweekly', 'monthly'] as const).map((interval) => (
                    <button
                      key={interval}
                      type="button"
                      onClick={() => setRecurringInterval(interval)}
                      className={`px-3 py-2 rounded-lg text-sm font-medium border-2 transition-all ${
                        recurringInterval === interval 
                          ? 'border-primary bg-primary/10 text-primary' 
                          : 'border-border text-muted-foreground hover:border-primary/30'
                      }`}
                    >
                      {interval === 'none' ? 'One-time' : interval.charAt(0).toUpperCase() + interval.slice(1)}
                    </button>
                  ))}
                </div>
                {recurringInterval !== 'none' && (
                  <p className="text-xs text-primary font-medium mt-2 flex items-center gap-1">
                    <Info className="w-3 h-3" />
                    Automated {recurringInterval} pickups will be created starting today.
                  </p>
                )}
              </div>

              <div className="pt-4 border-t border-border flex items-center justify-between">
                <div>
                  <div className="text-sm text-muted-foreground">Total Flat Fee</div>
                  <div className="text-3xl font-display font-bold text-foreground">${totalFee}</div>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-5 py-3 rounded-xl font-semibold text-muted-foreground hover:bg-secondary transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={createOrder.isPending}
                    className="px-6 py-3 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/25 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-50"
                  >
                    {createOrder.isPending ? 'Confirming...' : 'Confirm Pickup'}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {isUnlockOpen && unlockStatus.data && !unlockStatus.data.unlocked && (
        <CustomerUnlockDialog
          status={unlockStatus.data}
          onCancel={() => setIsUnlockOpen(false)}
          onUnlocked={handleUnlocked}
          refreshStatus={refreshUnlockStatus}
        />
      )}
    </div>
  );
}
