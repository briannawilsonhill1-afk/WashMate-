import { useState } from 'react';
import { motion } from 'framer-motion';
import { Droplets, Sparkles, Shield, Clock, ArrowRight, Mail, Lock, User as UserIcon, Loader2 } from 'lucide-react';
import { Link } from 'wouter';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/hooks/use-toast';
import type { PublicUser } from '@shared/schema';

type Mode = 'signin' | 'signup';

interface AuthResponse {
  message?: string;
  field?: string;
}

async function postAuth(path: string, body: Record<string, string>): Promise<PublicUser> {
  const res = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as AuthResponse;
    throw new Error(err.message || `${res.status}: ${res.statusText}`);
  }
  return res.json();
}

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const authMutation = useMutation({
    mutationFn: async () => {
      if (mode === 'signup') {
        return postAuth('/api/register', { email, password, firstName, lastName });
      }
      return postAuth('/api/login', { email, password });
    },
    onSuccess: (user) => {
      queryClient.setQueryData(['/api/auth/user'], user);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
    },
    onError: (err: Error) => {
      toast({
        title: mode === 'signup' ? 'Sign up failed' : 'Sign in failed',
        description: err.message,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    authMutation.mutate();
  };

  const isSignUp = mode === 'signup';

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
      <div className="container mx-auto px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 mb-12"
        >
          <div className="bg-primary/10 p-2 rounded-xl text-primary">
            <Droplets className="w-6 h-6" />
          </div>
          <span className="font-display font-bold text-xl text-foreground tracking-tight">
            Wash<span className="text-primary">Mate</span>
          </span>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-12 lg:gap-20 items-center max-w-6xl mx-auto">
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5 }}
          >
            <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-3 py-1.5 rounded-full text-sm font-semibold mb-6">
              <Sparkles className="w-4 h-4" />
              Fresh Laundry, Delivered
            </div>
            <h1 className="font-display text-4xl lg:text-5xl font-bold text-foreground leading-[1.1] tracking-tight mb-6">
              Laundry day,<br />
              <span className="text-primary">finally simplified.</span>
            </h1>
            <p className="text-base text-muted-foreground mb-8 leading-relaxed max-w-lg">
              Connect with trusted local washers for pickup, premium washing, and same-day delivery.
            </p>

            <div className="space-y-3 hidden lg:block">
              {[
                { icon: Sparkles, title: 'Premium Wash & Fold', desc: 'Hypoallergenic detergent, professional folding.' },
                { icon: Shield, title: 'Vetted Washers', desc: 'Background-checked independent washers.' },
                { icon: Clock, title: 'On Your Schedule', desc: 'Pickup and delivery, one-time or recurring.' },
              ].map((feature) => (
                <div
                  key={feature.title}
                  className="flex items-start gap-3 p-3 rounded-xl bg-background/60 backdrop-blur border border-border/50"
                >
                  <div className="bg-primary/10 p-2 rounded-lg text-primary shrink-0">
                    <feature.icon className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-foreground">{feature.title}</h3>
                    <p className="text-xs text-muted-foreground">{feature.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="bg-card rounded-3xl border border-border/50 p-8 shadow-xl"
          >
            <div className="flex gap-1 bg-secondary/50 p-1 rounded-xl mb-6">
              <button
                type="button"
                onClick={() => setMode('signin')}
                data-testid="tab-signin"
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                  mode === 'signin'
                    ? 'bg-white dark:bg-card text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => setMode('signup')}
                data-testid="tab-signup"
                className={`flex-1 py-2.5 text-sm font-bold rounded-lg transition-all ${
                  mode === 'signup'
                    ? 'bg-white dark:bg-card text-primary shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Create Account
              </button>
            </div>

            <h2 className="font-display text-2xl font-bold text-foreground mb-1">
              {isSignUp ? 'Create your account' : 'Welcome back'}
            </h2>
            <p className="text-sm text-muted-foreground mb-6">
              {isSignUp
                ? 'Sign up to start booking pickups or to wash with us.'
                : 'Sign in to continue to your dashboard.'}
            </p>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">First name</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                      <input
                        type="text"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        required
                        autoComplete="given-name"
                        placeholder="Jane"
                        className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                        data-testid="input-first-name"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1.5">Last name</label>
                    <input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      required
                      autoComplete="family-name"
                      placeholder="Doe"
                      className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                      data-testid="input-last-name"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    placeholder="you@example.com"
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    data-testid="input-email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-foreground mb-1.5">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={isSignUp ? 8 : undefined}
                    autoComplete={isSignUp ? 'new-password' : 'current-password'}
                    placeholder={isSignUp ? 'At least 8 characters' : 'Your password'}
                    className="w-full pl-10 pr-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
                    data-testid="input-password"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={authMutation.isPending}
                data-testid="button-submit-auth"
                className="w-full inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:-translate-y-0.5 transition-all disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:translate-y-0"
              >
                {authMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {isSignUp ? 'Creating account…' : 'Signing in…'}
                  </>
                ) : (
                  <>
                    {isSignUp ? 'Create Account' : 'Sign In'}
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>

            <p className="text-xs text-muted-foreground mt-5 text-center">
              By {isSignUp ? 'creating an account' : 'signing in'}, you agree to our{' '}
              <Link href="/privacy">
                <span className="text-primary hover:underline cursor-pointer">Privacy Policy</span>
              </Link>
              .
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
