---
name: Artifact manifest replacement
description: How to update protected artifact.toml files without bypassing Replit validation.
---

Do not edit an artifact's `.replit-artifact/artifact.toml` directly. Write the complete replacement to a sibling temporary TOML file, then pass both absolute paths to the verified artifact-manifest replacement callback.

**Why:** Direct patching is rejected even when the TOML is valid; the verified replacement flow validates the manifest and preserves artifact registration.

**How to apply:** Use this whenever changing an existing artifact's production build, serving, rewrite, port, or environment configuration. Confirm the temporary file is removed and read the final manifest after replacement.