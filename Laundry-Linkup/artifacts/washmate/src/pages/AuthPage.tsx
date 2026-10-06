import {
  Droplets,
  Sparkles,
  Shield,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { Link } from 'wouter';
import { landingContent } from '@/content/public-pages';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function LandingPage() {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-background via-background to-primary/5">
      <header className="container mx-auto px-4 py-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="bg-primary/10 p-2 rounded-xl text-primary">
            <Droplets className="w-6 h-6" />
          </div>
          <span className="font-display font-bold text-xl text-foreground tracking-tight">
            Wash<span className="text-primary">Mate</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/sign-in"
            data-analytics-event="account_signin_clicked"
            data-analytics-location="header"
            data-testid="link-signin"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-foreground hover:bg-secondary transition-colors"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            data-analytics-event="account_signup_clicked"
            data-analytics-location="header"
            data-testid="link-signup"
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-semibold bg-blue-700 text-white hover:bg-blue-800 transition-colors"
          >
            Get started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 pt-12 pb-20">
        <div className="max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-bold uppercase tracking-wider mb-6">
            <Sparkles className="w-3.5 h-3.5" />
            {landingContent.eyebrow}
          </div>
          <h1 className="font-display text-5xl sm:text-6xl font-bold text-foreground tracking-tight mb-6">
            {landingContent.headingLead} <span className="text-primary">{landingContent.headingAccent}</span>
          </h1>
          <p className="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">
            {landingContent.description}
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link
              href="/sign-up"
              data-analytics-event="account_signup_clicked"
              data-analytics-location="hero"
              data-testid="button-cta-signup"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-bold bg-blue-700 text-white hover:bg-blue-800 transition-colors shadow-lg shadow-primary/20"
            >
              Create your account
              <ArrowRight className="w-5 h-5" />
            </Link>
            <Link
              href="/sign-in"
              data-analytics-event="account_signin_clicked"
              data-analytics-location="hero"
              data-testid="button-cta-signin"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-base font-semibold text-foreground hover:bg-secondary transition-colors"
            >
              I already have an account
            </Link>
          </div>
        </div>

        <section
          aria-labelledby="benefits-heading"
          className="grid sm:grid-cols-3 gap-4 mt-20 max-w-4xl mx-auto"
        >
          <h2 id="benefits-heading" className="sr-only">{landingContent.benefitsHeading}</h2>
          {landingContent.benefits.map(({ icon, title, body }) => {
            const Icon = icon === 'clock' ? Clock : icon === 'shield' ? Shield : Sparkles;
            return (
            <div
              key={title}
              className="bg-card border border-border/50 rounded-2xl p-6 shadow-sm"
            >
              <div className="bg-primary/10 p-2.5 rounded-xl text-primary w-fit mb-4">
                <Icon className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-lg text-foreground mb-1.5">
                {title}
              </h3>
              <p className="text-sm text-muted-foreground">{body}</p>
            </div>
            );
          })}
        </section>
      </main>

      <footer className="container mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground transition-colors">
          Privacy Policy
        </Link>
      </footer>
    </div>
  );
}
