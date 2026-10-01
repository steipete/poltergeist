#!/usr/bin/env bash
set -euo pipefail

[[ $# -eq 2 ]] || { echo "Usage: $0 <binary-directory> <receipt.json>" >&2; exit 2; }
: "${APPLE_API_KEY_ID:?App Store Connect key ID required}"
: "${APPLE_API_ISSUER_ID:?App Store Connect issuer required}"
: "${APPLE_API_PRIVATE_KEY:?App Store Connect key required}"

binary_dir="$(cd "$1" && pwd)"
receipt="$2"
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/poltergeist-cli-notary.XXXXXX")"
trap 'rm -rf "$temp_dir"' EXIT
key_path="$temp_dir/AuthKey_${APPLE_API_KEY_ID}.p8"
printf '%s\n' "$APPLE_API_PRIVATE_KEY" > "$key_path"
chmod 600 "$key_path"
(cd "$binary_dir" && zip -q "$temp_dir/cli.zip" poltergeist polter)
xcrun notarytool submit "$temp_dir/cli.zip" \
  --key "$key_path" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID" \
  --wait --output-format json > "$receipt"
node -e 'const r = require(process.argv[1]); if (r.status !== "Accepted" || !r.id) throw new Error("CLI notarization was not accepted"); console.log(`CLI notarization accepted: ${r.id}`)' "$(cd "$(dirname "$receipt")" && pwd)/$(basename "$receipt")"
