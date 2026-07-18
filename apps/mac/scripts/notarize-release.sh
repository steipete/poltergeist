#!/bin/bash

set -euo pipefail

usage() {
    echo "Usage: $0 <Poltergeist.app>" >&2
    exit 2
}

[[ $# -eq 1 ]] || usage

APP_PATH="$1"
[[ -d "$APP_PATH" ]] || { echo "App not found: $APP_PATH" >&2; exit 1; }

if [[ -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER_ID:-}" || -z "${APPLE_API_PRIVATE_KEY:-}" ]]; then
    echo "App Store Connect API credentials are required" >&2
    exit 1
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/poltergeist-notary.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT

KEY_PATH="$TEMP_DIR/AuthKey_${APPLE_API_KEY_ID}.p8"
SUBMISSION_ZIP="$TEMP_DIR/Poltergeist-notary-submission.zip"

printf '%s\n' "$APPLE_API_PRIVATE_KEY" > "$KEY_PATH"
chmod 600 "$KEY_PATH"
ditto -c -k --keepParent "$APP_PATH" "$SUBMISSION_ZIP"

xcrun notarytool submit "$SUBMISSION_ZIP" \
    --key "$KEY_PATH" \
    --key-id "$APPLE_API_KEY_ID" \
    --issuer "$APPLE_API_ISSUER_ID" \
    --wait

xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"
