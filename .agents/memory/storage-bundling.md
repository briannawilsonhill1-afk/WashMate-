---
name: Storage bundling
description: Runtime dependency resolution for the storage SDK in the bundled API
---
Keep the storage SDK external when cloud dependencies are externalized by the API bundler.

**Why:** Bundling the SDK while externalizing its cloud dependency moves resolution to the API package scope. Under pnpm, that transitive dependency is not directly available there, so compilation can pass while startup fails.

**How to apply:** When changing storage dependencies or bundling, verify actual API startup as well as TypeScript and build success.