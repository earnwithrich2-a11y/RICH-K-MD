#!/usr/bin/env bash
set -euo pipefail

# Recreate the locked dependency tree after a task merge, then run the
# repository's non-interactive startup smoke check.
npm ci --no-audit --no-fund
npm run validate:startup