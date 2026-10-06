---
name: Static artifact caching
description: Browser cache headers on the published multi-artifact web service.
---

Do not assume root deployment response-header rules or the API server's static middleware apply to the separately served static web artifact. Check the published asset response before claiming a cache improvement.

**Why:** The published site returned `Cache-Control: private` for a fingerprinted JavaScript asset even though the root deployment configuration specified a long-lived `/assets/*` rule and the API server had an immutable-asset rule. Deployment logs showed a separate static handler registered for the web artifact. The supported way to set response headers on that handler was not established.

**How to apply:** For public-page performance work, confirm headers on a current published fingerprinted asset and on HTML. Use a documented artifact-level header mechanism or a user-approved CDN change; do not assume a root configuration change will affect the artifact.