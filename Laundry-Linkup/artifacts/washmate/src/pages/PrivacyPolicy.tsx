import { motion } from 'framer-motion';
import { Shield, Lock, Eye, MapPin, Shirt, Users, FileText, ArrowLeft, Droplets, AlertTriangle } from 'lucide-react';
import { Link } from 'wouter';
import { useAuth } from '@/hooks/use-auth';
import { privacyContent } from '@/content/public-pages';

const sectionIcons = {
  lock: Lock,
  mapPin: MapPin,
  shirt: Shirt,
  users: Users,
  alertTriangle: AlertTriangle,
  eye: Eye,
  shield: Shield,
  fileText: FileText,
} as const;

export default function PrivacyPolicy() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <Link href={user ? (user.role === 'customer' ? '/customer' : '/washer') : '/'}>
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 cursor-pointer" data-testid="link-back">
              <ArrowLeft className="w-4 h-4" />
              Back to {user ? 'Dashboard' : 'WashMate home'}
            </span>
          </Link>

          <div className="flex items-center gap-3 mb-2 mt-4">
            <div className="bg-primary/10 p-2.5 rounded-xl text-primary">
              <Shield className="w-7 h-7" />
            </div>
            <h1 className="font-display text-3xl font-bold text-foreground tracking-tight" data-testid="text-privacy-title">
              {privacyContent.title}
            </h1>
          </div>
          <p className="text-muted-foreground mb-8 ml-[52px]" data-testid="text-privacy-subtitle">
            {privacyContent.subtitle}
          </p>

          <div className="space-y-6">
            {privacyContent.sections.map((section, index) => {
              const SectionIcon = sectionIcons[section.icon];
              return (
              <motion.div
                key={section.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: index * 0.08 }}
                className="bg-card rounded-2xl border border-border/50 p-6 shadow-sm"
                data-testid={`card-privacy-section-${index}`}
              >
                <div className="flex items-start gap-4">
                  <div className="bg-primary/10 p-2 rounded-xl text-primary shrink-0 mt-0.5">
                    <SectionIcon className="w-5 h-5" />
                  </div>
                  <div className="flex-1">
                    <h2 className="font-display text-lg font-semibold text-foreground mb-3">
                      {section.title}
                    </h2>
                    <ul className="space-y-2">
                      {section.content.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground leading-relaxed">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 mt-1.5" />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </motion.div>
              );
            })}
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="mt-8 p-6 bg-card rounded-2xl border border-border/50 text-center"
            data-testid="card-privacy-contact"
          >
            <div className="flex items-center justify-center gap-2 mb-2">
              <Droplets className="w-5 h-5 text-primary" />
              <span className="font-display font-semibold text-foreground">
                Wash<span className="text-primary">Mate</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {privacyContent.contact}
            </p>
            <p className="text-xs text-muted-foreground/60 mt-2">
              Last updated: {privacyContent.lastUpdated}
            </p>
          </motion.div>
        </motion.div>
      </div>
    </div>
  );
}
