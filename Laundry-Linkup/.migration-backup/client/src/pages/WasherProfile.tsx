import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from '@/hooks/use-auth';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, buildUrl } from '@shared/routes';
import { useToast } from '@/hooks/use-toast';
import { SENSITIVE_FIELD_MASK } from '@shared/schema';
import { Link } from 'wouter';
import {
  ArrowLeft,
  CreditCard,
  User,
  Building2,
  Phone,
  FileText,
  Landmark,
  CheckCircle,
  AlertCircle,
  Shield,
  Search,
  Clock,
  ShieldCheck,
  ShieldX,
  MapPin,
} from 'lucide-react';

export default function WasherProfile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['/api/washer-profile'],
    queryFn: async () => {
      const res = await fetch(api.washerProfile.get.path, { credentials: 'include' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error('Failed to fetch profile');
      return res.json();
    },
    enabled: !!user,
  });

  const [legalName, setLegalName] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [phone, setPhone] = useState('');
  const [taxId, setTaxId] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [bankName, setBankName] = useState('');
  const [accountHolderName, setAccountHolderName] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountType, setAccountType] = useState<'checking' | 'savings'>('checking');
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [county, setCounty] = useState('');
  const [state, setState] = useState('');
  const [bgCheckConsent, setBgCheckConsent] = useState(false);
  const [bgSelfCertify, setBgSelfCertify] = useState(false);

  useEffect(() => {
    if (profile) {
      setLegalName(profile.legalName || '');
      setDateOfBirth(profile.dateOfBirth || '');
      setPhone(profile.phone || '');
      setTaxId(profile.taxId === SENSITIVE_FIELD_MASK ? '' : (profile.taxId || ''));
      setBusinessName(profile.businessName || '');
      setBankName(profile.bankName || '');
      setAccountHolderName(profile.accountHolderName || '');
      setRoutingNumber(profile.routingNumber === SENSITIVE_FIELD_MASK ? '' : (profile.routingNumber || ''));
      setAccountNumber(profile.accountNumber === SENSITIVE_FIELD_MASK ? '' : (profile.accountNumber || ''));
      setAccountType(profile.accountType || 'checking');
      setAgreedToTerms(profile.agreedToTerms || false);
      setCounty(profile.county || '');
      setState(profile.state || '');
      setBgCheckConsent(profile.bgCheckConsent || false);
      setBgSelfCertify(profile.bgSelfCertify || false);
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('Not logged in');
      const isExistingProfile = !!profile;
      const res = await fetch(api.washerProfile.upsert.path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          legalName,
          dateOfBirth,
          phone,
          taxId: isExistingProfile && !taxId ? SENSITIVE_FIELD_MASK : taxId,
          businessName: businessName || null,
          bankName,
          accountHolderName,
          routingNumber: isExistingProfile && !routingNumber ? SENSITIVE_FIELD_MASK : routingNumber,
          accountNumber: isExistingProfile && !accountNumber ? SENSITIVE_FIELD_MASK : accountNumber,
          accountType,
          agreedToTerms,
          county: county || null,
          state: state || null,
          bgCheckConsent,
          bgSelfCertify,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || 'Failed to save profile');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/washer-profile'] });
      toast({
        title: "Profile Saved",
        description: "Your payment and contractor information has been updated.",
      });
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!agreedToTerms) {
      toast({
        title: "Agreement Required",
        description: "You must agree to the independent contractor terms to continue.",
        variant: "destructive",
      });
      return;
    }
    saveMutation.mutate();
  };

  const isComplete = profile && profile.agreedToTerms;

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <Link href="/washer">
          <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer" data-testid="link-back-dashboard">
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </span>
        </Link>

        <div className="flex items-center gap-3 mb-2 mt-4">
          <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
            <CreditCard className="w-7 h-7" />
          </div>
          <div>
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tight" data-testid="text-profile-title">
              Washer Profile
            </h1>
            {isComplete && (
              <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 mt-1">
                <CheckCircle className="w-3.5 h-3.5" />
                Profile Complete
              </span>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mb-8 ml-[52px]">
          Payment information and independent contractor details.
        </p>

        <form onSubmit={handleSubmit} className="space-y-8">
          <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <User className="w-5 h-5" />
              </div>
              <h2 className="font-display text-lg font-semibold text-foreground">Personal Information</h2>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Legal Full Name *</label>
                <input
                  type="text"
                  value={legalName}
                  onChange={(e) => setLegalName(e.target.value)}
                  required
                  placeholder="John Michael Doe"
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  data-testid="input-legal-name"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Date of Birth *</label>
                <input
                  type="date"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  data-testid="input-dob"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Phone Number *</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    placeholder="(555) 123-4567"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    data-testid="input-phone"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Tax ID / SSN *</label>
                <div className="relative">
                  <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={taxId}
                    onChange={(e) => setTaxId(e.target.value)}
                    required={!profile}
                    placeholder={profile ? "Leave blank to keep existing" : "XXX-XX-XXXX"}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    data-testid="input-tax-id"
                  />
                </div>
                {profile && <p className="text-xs text-muted-foreground mt-1">Stored securely. Enter a new value only to update.</p>}
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <Building2 className="w-5 h-5" />
              </div>
              <h2 className="font-display text-lg font-semibold text-foreground">Business Information</h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">Business Name (Optional)</label>
              <input
                type="text"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                placeholder="Your business or DBA name"
                className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                data-testid="input-business-name"
              />
              <p className="text-xs text-muted-foreground mt-1.5">Leave blank if operating under your personal name.</p>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <Landmark className="w-5 h-5" />
              </div>
              <h2 className="font-display text-lg font-semibold text-foreground">Payment Information</h2>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">Bank Name *</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  required
                  placeholder="Bank of America, Chase, etc."
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  data-testid="input-bank-name"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">Account Holder Name *</label>
                <input
                  type="text"
                  value={accountHolderName}
                  onChange={(e) => setAccountHolderName(e.target.value)}
                  required
                  placeholder="Name as it appears on the account"
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  data-testid="input-account-holder"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Routing Number *</label>
                <input
                  type="text"
                  value={routingNumber}
                  onChange={(e) => setRoutingNumber(e.target.value)}
                  required={!profile}
                  placeholder={profile ? "Leave blank to keep existing" : "9 digits"}
                  maxLength={9}
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all font-mono"
                  data-testid="input-routing"
                />
                {profile && <p className="text-xs text-muted-foreground mt-1">Stored securely. Enter a new value only to update.</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Account Number *</label>
                <input
                  type="text"
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  required={!profile}
                  placeholder={profile ? "Leave blank to keep existing" : "Account number"}
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all font-mono"
                  data-testid="input-account-number"
                />
                {profile && <p className="text-xs text-muted-foreground mt-1">Stored securely. Enter a new value only to update.</p>}
              </div>
              <div className="sm:col-span-2">
                <label className="block text-sm font-medium text-foreground mb-1.5">Account Type *</label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setAccountType('checking')}
                    className={`flex-1 px-4 py-3 rounded-xl font-medium text-sm border transition-all ${
                      accountType === 'checking'
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground'
                    }`}
                    data-testid="button-checking"
                  >
                    Checking
                  </button>
                  <button
                    type="button"
                    onClick={() => setAccountType('savings')}
                    className={`flex-1 px-4 py-3 rounded-xl font-medium text-sm border transition-all ${
                      accountType === 'savings'
                        ? 'bg-primary/10 border-primary text-primary'
                        : 'bg-secondary/50 border-border/50 text-muted-foreground hover:text-foreground'
                    }`}
                    data-testid="button-savings"
                  >
                    Savings
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <Search className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-display text-lg font-semibold text-foreground">Background Check Verification</h2>
                {profile?.bgCheckStatus && profile.bgCheckStatus !== 'not_started' && (
                  <div className={`inline-flex items-center gap-1.5 mt-1 text-xs font-bold ${
                    profile.bgCheckStatus === 'cleared' ? 'text-emerald-600' :
                    profile.bgCheckStatus === 'pending' ? 'text-amber-600' :
                    'text-red-600'
                  }`}>
                    {profile.bgCheckStatus === 'cleared' && <ShieldCheck className="w-3.5 h-3.5" />}
                    {profile.bgCheckStatus === 'pending' && <Clock className="w-3.5 h-3.5" />}
                    {profile.bgCheckStatus === 'flagged' && <ShieldX className="w-3.5 h-3.5" />}
                    {profile.bgCheckStatus === 'cleared' ? 'Cleared' :
                     profile.bgCheckStatus === 'pending' ? 'Check In Progress' :
                     'Flagged — Contact Support'}
                  </div>
                )}
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4 mb-5 text-sm text-amber-800 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <p>WashMate requires all washers to pass a soft background check before they can claim jobs. This includes a search of the registered sex offender registry in your county and state of residence. You must provide your location and consent to proceed.</p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">County of Residence *</label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="text"
                    value={county}
                    onChange={(e) => setCounty(e.target.value)}
                    placeholder="e.g. Los Angeles County"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    data-testid="input-county"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">State *</label>
                <input
                  type="text"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                  placeholder="e.g. California"
                  className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                  data-testid="input-state"
                />
              </div>
            </div>

            <div className="space-y-3">
              <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-bg-consent">
                <input
                  type="checkbox"
                  checked={bgCheckConsent}
                  onChange={(e) => setBgCheckConsent(e.target.checked)}
                  disabled={profile?.bgCheckStatus === 'cleared'}
                  className="mt-1 w-5 h-5 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:opacity-50"
                  data-testid="checkbox-bg-consent"
                />
                <span className="text-sm text-foreground font-medium group-hover:text-primary transition-colors">
                  I consent to WashMate conducting a soft background check, including a search of the National Sex Offender Public Website (NSOPW) and applicable county/state registries for my area of residence.
                </span>
              </label>

              <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-bg-certify">
                <input
                  type="checkbox"
                  checked={bgSelfCertify}
                  onChange={(e) => setBgSelfCertify(e.target.checked)}
                  disabled={profile?.bgCheckStatus === 'cleared'}
                  className="mt-1 w-5 h-5 rounded border-border text-primary focus:ring-primary/30 cursor-pointer disabled:opacity-50"
                  data-testid="checkbox-bg-certify"
                />
                <span className="text-sm text-foreground font-medium group-hover:text-primary transition-colors">
                  I certify under penalty of perjury that I am not listed on any sex offender registry, and I have no pending charges or convictions related to offenses against persons in any jurisdiction.
                </span>
              </label>
            </div>

            {profile?.bgCheckStatus === 'cleared' && (
              <div className="mt-4 flex items-center gap-2 text-sm text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 p-3 rounded-xl">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                Your background check has been cleared. You are eligible to claim jobs.
              </div>
            )}

            {profile?.bgCheckStatus === 'pending' && (
              <div className="mt-4 flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl">
                <Clock className="w-4 h-4 shrink-0" />
                Your background check is being processed. This typically takes a few moments. Please refresh the page shortly.
              </div>
            )}

            {profile?.bgCheckStatus === 'flagged' && (
              <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 dark:bg-red-950/30 p-3 rounded-xl">
                <ShieldX className="w-4 h-4 shrink-0" />
                Your background check returned a flag. Please contact WashMate support for assistance.
              </div>
            )}
          </div>

          <div className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
            <div className="flex items-center gap-3 mb-5">
              <div className="bg-primary/10 p-2 rounded-xl text-primary">
                <Shield className="w-5 h-5" />
              </div>
              <h2 className="font-display text-lg font-semibold text-foreground">Independent Contractor Agreement</h2>
            </div>

            <div className="bg-secondary/30 rounded-xl p-4 mb-4 text-sm text-muted-foreground space-y-2">
              <p>By checking the box below, you acknowledge and agree to the following:</p>
              <ul className="space-y-1.5 ml-4">
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You are an independent contractor and not an employee of WashMate.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You are responsible for reporting your own income and paying applicable taxes.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You agree to handle all customer belongings with care and maintain strict confidentiality regarding customer information.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You understand that WashMate may issue a 1099 form for tax purposes based on your earnings.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You will provide your own equipment and supplies for washing services unless otherwise arranged.
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                  You agree to WashMate's <Link href="/privacy"><span className="text-primary hover:underline cursor-pointer">Privacy Policy</span></Link> and terms of service.
                </li>
              </ul>
            </div>

            <label className="flex items-start gap-3 cursor-pointer group" data-testid="label-agree-terms">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-1 w-5 h-5 rounded border-border text-primary focus:ring-primary/30 cursor-pointer"
                data-testid="checkbox-agree-terms"
              />
              <span className="text-sm text-foreground font-medium group-hover:text-primary transition-colors">
                I have read and agree to the independent contractor terms, and I confirm that all information provided above is accurate.
              </span>
            </label>
          </div>

          {!agreedToTerms && (
            <div className="flex items-center gap-2 text-sm text-amber-600 bg-amber-50 dark:bg-amber-950/30 p-3 rounded-xl">
              <AlertCircle className="w-4 h-4 shrink-0" />
              You must agree to the independent contractor terms before saving.
            </div>
          )}

          <button
            type="submit"
            disabled={saveMutation.isPending || !agreedToTerms}
            className="w-full py-4 rounded-xl font-bold text-lg bg-gradient-to-r from-primary to-blue-500 text-white shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200 disabled:opacity-70 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            data-testid="button-save-profile"
          >
            {saveMutation.isPending ? 'Saving...' : (profile ? 'Update Profile' : 'Save Profile')}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
