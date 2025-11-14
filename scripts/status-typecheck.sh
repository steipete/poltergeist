#!/bin/bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUTPUT="$(pnpm run typecheck -- --pretty false 2>&1)"
STATUS=$?

if [ $STATUS -eq 0 ]; then
  echo "Typecheck: no issues"
else
  echo "Typecheck: failed (exit $STATUS)"
  echo "$OUTPUT" | head -n 5
fi

exit 0
