import { landingContent, privacyContent } from "../content/public-pages";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderStaticLandingPage(): string {
  const benefits = landingContent.benefits
    .map(
      ({ title, body }) => `
        <article class="bg-card border border-border/50 rounded-2xl p-6 shadow-sm">
          <h3 class="font-display font-bold text-lg text-foreground mb-1.5">${escapeHtml(title)}</h3>
          <p class="text-sm text-muted-foreground">${escapeHtml(body)}</p>
        </article>`,
    )
    .join("");

  return `
    <div data-static-page="landing" class="min-h-[100dvh] bg-gradient-to-br from-background via-background to-primary/5">
      <header class="container mx-auto px-4 py-6 flex items-center justify-between">
        <a href="/" class="font-display font-bold text-xl text-foreground tracking-tight" aria-label="WashMate home">Wash<span class="text-primary">Mate</span></a>
        <nav aria-label="Account">
          <a href="/sign-in" data-analytics-event="account_signin_clicked" data-analytics-location="header" class="px-4 py-2 text-sm font-semibold text-foreground">Sign in</a>
          <a href="/sign-up" data-analytics-event="account_signup_clicked" data-analytics-location="header" class="inline-flex px-4 py-2 rounded-lg text-sm font-semibold bg-blue-700 text-white">Get started</a>
        </nav>
      </header>
      <main class="container mx-auto px-4 pt-12 pb-20">
        <div class="max-w-3xl mx-auto text-center">
          <p class="text-primary text-xs font-bold uppercase tracking-wider mb-6">${escapeHtml(landingContent.eyebrow)}</p>
          <h1 class="font-display text-5xl sm:text-6xl font-bold text-foreground tracking-tight mb-6">
            ${escapeHtml(landingContent.headingLead)} <span class="text-primary">${escapeHtml(landingContent.headingAccent)}</span>
          </h1>
          <p class="text-lg text-muted-foreground mb-10 max-w-xl mx-auto">${escapeHtml(landingContent.description)}</p>
          <p>
            <a href="/sign-up" data-analytics-event="account_signup_clicked" data-analytics-location="hero" class="inline-flex px-6 py-3 rounded-xl text-base font-bold bg-blue-700 text-white">Create your account</a>
            <a href="/sign-in" data-analytics-event="account_signin_clicked" data-analytics-location="hero" class="inline-flex px-6 py-3 text-base font-semibold text-foreground">I already have an account</a>
          </p>
        </div>
        <section aria-labelledby="static-benefits-heading" class="grid sm:grid-cols-3 gap-4 mt-20 max-w-4xl mx-auto">
          <h2 id="static-benefits-heading" class="sr-only">${escapeHtml(landingContent.benefitsHeading)}</h2>
          ${benefits}
        </section>
      </main>
      <footer class="container mx-auto px-4 py-6 text-center text-xs text-muted-foreground">
        <a href="/privacy">Privacy Policy</a>
      </footer>
    </div>`;
}

export function renderStaticPrivacyPage(): string {
  const sections = privacyContent.sections
    .map(
      ({ title, content }) => `
        <section class="bg-card rounded-2xl border border-border/50 p-6 shadow-sm">
          <h2 class="font-display text-lg font-semibold text-foreground mb-3">${escapeHtml(title)}</h2>
          <ul class="space-y-2">
            ${content.map((item) => `<li class="text-sm text-muted-foreground leading-relaxed">${escapeHtml(item)}</li>`).join("")}
          </ul>
        </section>`,
    )
    .join("");

  return `
    <div data-static-page="privacy" class="min-h-screen bg-background">
      <main class="container mx-auto px-4 py-8 max-w-4xl">
        <a href="/" class="inline-flex text-sm text-muted-foreground mb-6">Back to WashMate</a>
        <h1 class="font-display text-3xl font-bold text-foreground tracking-tight">${escapeHtml(privacyContent.title)}</h1>
        <p class="text-muted-foreground mb-8">${escapeHtml(privacyContent.subtitle)}</p>
        <div class="space-y-6">${sections}</div>
        <footer class="mt-8 p-6 bg-card rounded-2xl border border-border/50 text-center">
          <a href="/" class="font-display font-semibold text-foreground">WashMate</a>
          <p class="text-sm text-muted-foreground">${escapeHtml(privacyContent.contact)}</p>
          <p class="text-xs text-muted-foreground mt-2">Last updated: ${escapeHtml(privacyContent.lastUpdated)}</p>
        </footer>
      </main>
    </div>`;
}