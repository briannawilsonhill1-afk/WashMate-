import { useEffect, useMemo, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { Elements, PaymentElement, useElements, useStripe } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';
import { Check, CreditCard, LoaderCircle, LockKeyhole, X } from 'lucide-react';
import {
  confirmCustomerUnlock,
  type CustomerUnlockStatus,
  useStartCustomerUnlockPayment,
} from '@/hooks/use-customer-unlock';

interface CustomerUnlockDialogProps {
  status: CustomerUnlockStatus;
  onCancel: () => void;
  onUnlocked: () => void;
  refreshStatus: () => Promise<boolean>;
}

interface PaymentFormProps {
  amount: string;
  onCancel: () => void;
  onUnlocked: () => void;
  refreshStatus: () => Promise<boolean>;
}

function PaymentForm({ amount, onCancel, onUnlocked, refreshStatus }: PaymentFormProps) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const confirmationTracked = useRef(false);

  const finishConfirmation = async () => {
    const result = await confirmCustomerUnlock();
    if (!result.unlocked) throw new Error('Payment could not be verified.');
    const unlocked = await refreshStatus();
    if (!unlocked) throw new Error('Payment is still being verified. Please check again.');
    if (!confirmationTracked.current) {
      confirmationTracked.current = true;
      trackEvent('unlock_payment_confirmed', { amount_cents: 299, currency: 'usd' });
    }
    onUnlocked();
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!stripe || !elements || isSubmitting) return;

    setIsSubmitting(true);
    setIsPending(false);
    setMessage(null);

    try {
      const returnUrl = new URL(window.location.href);
      returnUrl.searchParams.set('customer_unlock_return', '1');

      const result = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: returnUrl.toString() },
        redirect: 'if_required',
      });

      if (result.error) {
        setMessage(result.error.message || 'Payment was not completed. Please try again.');
        return;
      }

      const paymentStatus = result.paymentIntent?.status;
      if (paymentStatus === 'processing') {
        setIsPending(true);
        setMessage('Your payment is processing. You can check again without being charged twice.');
        return;
      }
      if (paymentStatus !== 'succeeded') {
        setMessage('Payment was not completed. You can safely try again.');
        return;
      }

      await finishConfirmation();
    } catch (error) {
      setIsPending(true);
      setMessage(error instanceof Error ? error.message : 'Could not verify payment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckAgain = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setMessage(null);
    try {
      await finishConfirmation();
    } catch (error) {
      setIsPending(true);
      setMessage(error instanceof Error ? error.message : 'Payment is still being verified.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="rounded-xl border border-border bg-background p-3">
        <PaymentElement options={{ layout: 'tabs' }} />
      </div>
      {message && (
        <div
          className={`rounded-xl border p-3 text-sm ${isPending ? 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200' : 'border-destructive/30 bg-destructive/10 text-destructive'}`}
          role="status"
          data-testid="status-unlock-payment"
        >
          {message}
        </div>
      )}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isSubmitting}
          className="px-5 py-3 rounded-xl font-semibold text-muted-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          data-testid="button-cancel-unlock-payment"
        >
          Cancel
        </button>
        {isPending ? (
          <button
            type="button"
            onClick={handleCheckAgain}
            disabled={isSubmitting}
            className="px-6 py-3 rounded-xl font-bold bg-primary text-primary-foreground disabled:opacity-50"
            data-testid="button-check-unlock-payment"
          >
            {isSubmitting ? 'Checking…' : 'Check payment status'}
          </button>
        ) : (
          <button
            type="submit"
            disabled={!stripe || !elements || isSubmitting}
            className="px-6 py-3 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-50"
            data-testid="button-submit-unlock-payment"
          >
            {isSubmitting ? 'Processing…' : `Pay ${amount} securely`}
          </button>
        )}
      </div>
    </form>
  );
}

export function CustomerUnlockDialog({
  status,
  onCancel,
  onUnlocked,
  refreshStatus,
}: CustomerUnlockDialogProps) {
  const startPayment = useStartCustomerUnlockPayment();
  const [paymentConfig, setPaymentConfig] = useState<{ clientSecret: string; publishableKey: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const stripePromise = useMemo(
    () => paymentConfig ? loadStripe(paymentConfig.publishableKey) : null,
    [paymentConfig?.publishableKey],
  );

  useEffect(() => {
    if (!status.unlocked) return;
    onUnlocked();
  }, [status.unlocked, onUnlocked]);

  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: status.currency.toUpperCase(),
  }).format(status.amountCents / 100);

  const handleContinue = () => {
    if (startPayment.isPending) return;
    setMessage(null);
    startPayment.mutate(undefined, {
      onSuccess: (result) => {
        if ('unlocked' in result && result.unlocked) {
          onUnlocked();
          return;
        }
        if ('clientSecret' in result) setPaymentConfig(result);
      },
      onError: (error) => setMessage(error.message),
    });
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-unlock-title"
        className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto bg-card rounded-3xl shadow-2xl border border-border"
        data-testid="dialog-customer-unlock"
      >
        <div className="p-6 border-b border-border flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
              <LockKeyhole className="w-5 h-5" />
            </div>
            <div>
              <h2 id="customer-unlock-title" className="text-2xl font-display font-bold text-foreground">
                Unlock pickup requests
              </h2>
              <p className="text-sm text-muted-foreground mt-1">A one-time customer account unlock.</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close payment"
            className="p-2 rounded-lg text-muted-foreground hover:bg-secondary"
            data-testid="button-close-unlock"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="rounded-2xl bg-secondary/50 border border-border p-4 mb-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="font-bold text-foreground">WashMate customer unlock</div>
                <div className="text-sm text-muted-foreground">Pay once, then request pickups anytime.</div>
              </div>
              <div className="text-2xl font-display font-bold text-foreground" data-testid="text-unlock-price">
                {amount}
              </div>
            </div>
          </div>

          <ul className="space-y-2 mb-6 text-sm text-foreground">
            <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> One-time charge — no monthly subscription</li>
            <li className="flex gap-2"><Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> Laundry and order fees are separate and shown before each order</li>
            <li className="flex gap-2"><CreditCard className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" /> Secure payment powered by Stripe</li>
          </ul>

          {message && (
            <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert" data-testid="status-unlock-start-error">
              {message}
            </div>
          )}

          {paymentConfig && stripePromise ? (
            <Elements
              stripe={stripePromise}
              options={{
                clientSecret: paymentConfig.clientSecret,
                appearance: { theme: 'stripe', variables: { borderRadius: '12px' } },
              }}
            >
              <PaymentForm amount={amount} onCancel={onCancel} onUnlocked={onUnlocked} refreshStatus={refreshStatus} />
            </Elements>
          ) : (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={onCancel}
                disabled={startPayment.isPending}
                className="px-5 py-3 rounded-xl font-semibold text-muted-foreground hover:bg-secondary disabled:opacity-50"
                data-testid="button-cancel-unlock"
              >
                Not now
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={startPayment.isPending}
                className="px-6 py-3 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/25 disabled:opacity-50 flex items-center justify-center gap-2"
                data-testid="button-start-unlock-payment"
              >
                {startPayment.isPending && <LoaderCircle className="w-4 h-4 animate-spin" />}
                {startPayment.isPending ? 'Preparing payment…' : `Continue — ${amount} once`}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}