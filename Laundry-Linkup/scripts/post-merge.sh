#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."

CI=true pnpm install --frozen-lockfile
# Do not automatically approve destructive schema changes.
pnpm --filter @workspace/db run push </dev/null
pnpm run typecheck:libs
