// Order matters: the first entry is used as the canonical public host
// (e.g. Stripe return URLs), so explicit configuration wins over the
// hostnames Vercel injects automatically.
const DOMAIN_ENV_VARS = [
  "REPLIT_DOMAINS",
  "ALLOWED_DOMAINS",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_BRANCH_URL",
  "VERCEL_URL",
] as const;

/**
 * Hostnames (no scheme) this deployment is served from. Used to build the
 * credentialed-CORS allowlist and the Clerk proxy host allowlist.
 */
export function deploymentDomains(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const domains = new Set<string>();
  for (const name of DOMAIN_ENV_VARS) {
    for (const domain of (env[name] ?? "").split(",")) {
      const trimmed = domain.trim().toLowerCase();
      if (trimmed) domains.add(trimmed);
    }
  }
  return [...domains];
}
