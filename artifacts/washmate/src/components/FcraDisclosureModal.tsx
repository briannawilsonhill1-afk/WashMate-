import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { FileText, Loader2, X } from 'lucide-react';

/**
 * Standalone FCRA disclosure + written authorization flow.
 *
 * Federal guidance describes the background-check disclosure as a clear,
 * conspicuous, STANDALONE document — not bundled with other consents or
 * terms. This modal is therefore its own screen: step 1 shows ONLY the
 * disclosure text, step 2 is a SINGLE, separate authorization checkbox.
 * Nothing else (no ToS, no marketing, no other consents) appears here.
 *
 * The disclosure text is served versioned from the server; the authorization
 * records timestamp + IP + disclosure version server-side.
 */
export default function FcraDisclosureModal({
  open,
  onClose,
  onAuthorized,
  authorizedVersion,
}: {
  open: boolean;
  onClose: () => void;
  onAuthorized: () => void;
  /** The disclosure version the washer last authorized under, if any. */
  authorizedVersion?: string | null;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<1 | 2>(1);
  const [disclosure, setDisclosure] = useState<{ version: string; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setChecked(false);
    setError(null);
    setDisclosure(null);
    setLoading(true);
    fetch(api.washerProfile.fcraDisclosure.path, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Could not load the disclosure');
        return res.json();
      })
      .then((data) => setDisclosure(data))
      .catch((err) => setError(err.message || 'Could not load the disclosure'))
      .finally(() => setLoading(false));
  }, [open ]);

  const authorizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(api.washerProfile.fcraAuthorize.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authorized: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Authorization failed');
      }
      return res.json();
    },
    onSuccess: (data: { bgCheckStatus?: string }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/washer-profile'] });
      toast({
        title: 'Authorization recorded',
        description: data?.bgCheckStatus === 'pending'
          ? 'Your background check authorization has been recorded and your screening has been submitted.'
          : 'Your background check authorization has been recorded. Complete and save your profile to submit the screening.',
      });
      onAuthorized();
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    },
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" data-testid="fcra-disclosure-modal">
      <div className="bg-card rounded-2xl border border-border/50 shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 pb-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 p-2 rounded-xl text-primary">
              <FileText className="w-5 h-5" />
            </div>
            <h2 className="font-display text-lg font-semibold text-foreground">
              {step === 1 ? 'Background Check Disclosure' : 'Written Authorization'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-muted-foreground hover:bg-secondary/50 transition-colors"
            aria-label="Close"
            data-testid="button-fcra-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === 1 && (
          <div className="p-6 overflow-y-auto">
            {loading && (
              <div className="flex items-center justify-center py-12 text-muted-foreground">
                <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading disclosure…
              </div>
            )}
            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-950/30 p-4 rounded-xl">
                {error}
              </div>
            )}
            {disclosure && (
              <>
                {authorizedVersion && authorizedVersion !== disclosure.version && (
                  <div className="text-sm text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/30 p-4 rounded-xl mb-4" data-testid="fcra-version-stale-notice">
                    The disclosure has been updated since you last authorized (v{authorizedVersion} → v{disclosure.version}).
                    Please review the new text and authorize again.
                  </div>
                )}
                <pre
                  className="whitespace-pre-wrap font-sans text-sm text-foreground bg-secondary/30 border border-border/50 rounded-xl p-5 leading-relaxed"
                  data-testid="fcra-disclosure-text"
                >
                  {disclosure.text}
                </pre>
                <p className="text-xs text-muted-foreground mt-3">
                  This disclosure is shown on its own, separate from any other documents or consents.
                </p>
              </>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="p-6">
            <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-fcra-authorize">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                data-testid="checkbox-fcra-authorize"
              />
              <span className="text-sm text-foreground font-medium group-hover:text-primary transition-colors">
                I have read the background check disclosure above, and I authorize WashMate to obtain a consumer
                report about me from Checkr, Inc. for the purpose of evaluating my eligibility as an independent
                washer. I understand I may request a copy of any report obtained about me.
              </span>
            </label>
          </div>
        )}

        <div className="p-6 pt-4 border-t border-border/50 flex justify-end gap-3">
          {step === 1 ? (
            <button
              onClick={() => setStep(2)}
              disabled={!disclosure || loading}
              className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 transition-all"
              data-testid="button-fcra-continue"
            >
              Continue
            </button>
          ) : (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-6 py-3 rounded-xl bg-secondary text-foreground font-semibold transition-all"
                data-testid="button-fcra-back"
              >
                Back
              </button>
              <button
                onClick={() => authorizeMutation.mutate()}
                disabled={!checked || authorizeMutation.isPending}
                className="px-6 py-3 rounded-xl bg-primary text-primary-foreground font-semibold disabled:opacity-50 transition-all flex items-center gap-2"
                data-testid="button-fcra-authorize"
              >
                {authorizeMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                I Authorize
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
