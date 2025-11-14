#!/bin/bash
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUTPUT="$(pnpm run lint -- --color never 2>&1)"
STATUS=$?

if [ $STATUS -eq 0 ]; then
  echo "Biome: no issues"
else
  echo "Biome: failed (exit $STATUS)"
  echo "$OUTPUT" | head -n 5
fi

exit 0
