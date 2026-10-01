#!/usr/bin/env bash

set -euo pipefail
test -n "$MACOS_DEVELOPER_ID_P12"
test -n "$MACOS_DEVELOPER_ID_P12_PASSWORD"

certificate_path="$RUNNER_TEMP/poltergeist-developer-id.p12"
keychain_path="$RUNNER_TEMP/poltergeist-signing.keychain-db"
ephemeral_keychain_passphrase="$(openssl rand -base64 32)"
trap 'rm -f "$certificate_path"' EXIT
echo "POLTERGEIST_CI_KEYCHAIN=$keychain_path" >> "$GITHUB_ENV"

printf '%s' "$MACOS_DEVELOPER_ID_P12" | base64 --decode > "$certificate_path"
security create-keychain -p "$ephemeral_keychain_passphrase" "$keychain_path"
security set-keychain-settings -lut 3600 "$keychain_path"
security unlock-keychain -p "$ephemeral_keychain_passphrase" "$keychain_path"
security import "$certificate_path" \
  -k "$keychain_path" \
  -P "$MACOS_DEVELOPER_ID_P12_PASSWORD" \
  -T /usr/bin/codesign \
  -T /usr/bin/security
rm -f "$certificate_path"
security set-key-partition-list \
  -S apple-tool:,apple:,codesign: \
  -s \
  -k "$ephemeral_keychain_passphrase" \
  "$keychain_path"
security list-keychains -d user -s "$keychain_path"
security find-identity -v -p codesigning "$keychain_path" | \
  grep -F '"Developer ID Application: Peter Steinberger (Y5PE65HELJ)"'
