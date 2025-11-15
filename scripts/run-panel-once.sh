#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[panel] starting"
POLTERGEIST_INPUT_DEBUG=1 pnpm exec tsx src/cli.ts panel
echo "[panel] closed"
