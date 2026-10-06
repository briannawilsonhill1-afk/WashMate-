# SEO Strategy

## In scope
- Public WashMate marketing landing page (`/`)
- Public privacy policy (`/privacy`)
- Public crawl, social-sharing, PWA brand, and AI-discovery assets

## Out of scope
- Authenticated customer and washer dashboards
- Sign-in, sign-up, role-selection, settings, order, incident, and admin flows except where they affect public crawl behavior
- API-only and native iOS application surfaces

## Target audience
- People seeking local laundry pickup, washing, folding, and delivery services
- Prospective local washers are a secondary audience

## Primary keywords
- Local laundry pickup and delivery
- Laundry pickup service
- Wash and fold delivery

## Rendering and crawler assumptions
- The public web app is currently a Vite/React SPA served through an Express static fallback.
- Search, social preview, and AI crawler visibility must be evaluated from the initial HTML response, not post-JavaScript rendering.

## Dismissed categories
- (None yet)
