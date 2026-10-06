import { useState } from 'react';
import { motion } from 'framer-motion';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/hooks/use-auth';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';
import { api } from '@shared/routes';
import { ShoppingBag, Sparkles, ArrowRight, MapPin } from 'lucide-react';
import { useLocation } from 'wouter';

export default function RoleSelection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [role, setRole] = useState<'customer' | 'washer' | null>(null);
  const [address, setAddress] = useState('');

  const updateProfile = useMutation({
    mutationFn: async (data: { role: 'customer' | 'washer'; address: string }) => {
      const res = await apiRequest('POST', api.profile.update.path, data);
      return res.json();
    },
    onSuccess: (updated: any) => {
      queryClient.setQueryData(['/api/auth/user'], updated);
      queryClient.invalidateQueries({ queryKey: ['/api/auth/user'] });
      toast({ title: 'Welcome to WashMate!', description: 'Your profile is set up.' });
      setLocation(updated.role === 'customer' ? '/customer' : '/washer');
    },
    onError: (err: Error) => {
      toast({ title: 'Could not save', description: err.message, variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!role || address.trim().length < 5) {
      toast({ title: 'Missing info', description: 'Pick a role and enter your address.', variant: 'destructive' });
      return;
    }
    updateProfile.mutate({ role, address: address.trim() });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 py-12 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-10">
          <h1 className="font-display text-4xl font-bold text-foreground mb-3">
            Welcome{user?.firstName ? `, ${user.firstName}` : ''}!
          </h1>
          <p className="text-muted-foreground text-lg">Tell us how you'll use WashMate.</p>
        </motion.div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <button
              type="button"
              onClick={() => setRole('customer')}
              data-testid="button-role-customer"
              className={`text-left p-6 rounded-2xl border-2 transition-all ${
                role === 'customer'
                  ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                  : 'border-border bg-background/60 hover:border-primary/30'
              }`}
            >
              <div className="bg-primary/10 p-3 rounded-xl text-primary w-fit mb-4">
                <ShoppingBag className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-xl text-foreground mb-2">I need laundry done</h3>
              <p className="text-sm text-muted-foreground">Order pickup, washing, and delivery from local washers.</p>
            </button>

            <button
              type="button"
              onClick={() => setRole('washer')}
              data-testid="button-role-washer"
              className={`text-left p-6 rounded-2xl border-2 transition-all ${
                role === 'washer'
                  ? 'border-primary bg-primary/5 shadow-lg shadow-primary/10'
                  : 'border-border bg-background/60 hover:border-primary/30'
              }`}
            >
              <div className="bg-primary/10 p-3 rounded-xl text-primary w-fit mb-4">
                <Sparkles className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-xl text-foreground mb-2">I want to earn washing</h3>
              <p className="text-sm text-muted-foreground">Claim local jobs and get paid for premium wash & fold.</p>
            </button>
          </div>

          <div className="bg-background/60 backdrop-blur border border-border/50 rounded-2xl p-6">
            <label className="block text-sm font-bold text-foreground mb-2 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              {role === 'washer' ? 'Service Area Address' : 'Pickup Address'}
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="123 Main St, City, State"
              data-testid="input-address"
              className="w-full px-4 py-3 rounded-xl bg-secondary/50 border border-border/50 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
            <p className="text-xs text-muted-foreground mt-2">
              {role === 'washer'
                ? 'This is the area you serve. It is never shown to customers.'
                : 'Only revealed to your assigned washer once they accept your order.'}
            </p>
          </div>

          <button
            type="submit"
            disabled={updateProfile.isPending || !role || address.trim().length < 5}
            data-testid="button-submit-profile"
            className="w-full px-7 py-4 rounded-xl font-bold bg-primary text-primary-foreground shadow-lg shadow-primary/30 hover:shadow-xl hover:-translate-y-0.5 transition-all text-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {updateProfile.isPending ? 'Saving...' : 'Continue'}
            <ArrowRight className="w-5 h-5" />
          </button>
        </form>
      </div>
    </div>
  );
}
