#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$APP_ROOT/../.." && pwd)"

readonly EXPECTED_IDENTITY="Developer ID Application: Peter Steinberger (Y5PE65HELJ)"
readonly TEAM_ID="Y5PE65HELJ"

SIGNING_IDENTITY="${POLTERGEIST_CODESIGN_IDENTITY:-$EXPECTED_IDENTITY}"
DERIVED_DATA_PATH="${POLTERGEIST_DERIVED_DATA_PATH:-$APP_ROOT/build}"
VERSION="${POLTERGEIST_VERSION:-$(node -p "JSON.parse(require('fs').readFileSync('$REPO_ROOT/package.json', 'utf8')).version")}"
BUILD_NUMBER="${POLTERGEIST_BUILD_NUMBER:-1}"

if [[ "$DERIVED_DATA_PATH" != /* || "$DERIVED_DATA_PATH" == "/" ]]; then
    echo "Derived data path must be an absolute, non-root path: $DERIVED_DATA_PATH" >&2
    exit 1
fi

if [[ "$SIGNING_IDENTITY" != "$EXPECTED_IDENTITY" ]]; then
    echo "Refusing unexpected signing identity: $SIGNING_IDENTITY" >&2
    echo "Expected: $EXPECTED_IDENTITY" >&2
    exit 1
fi

if ! security find-identity -v -p codesigning | grep -Fq "\"$EXPECTED_IDENTITY\""; then
    echo "Required signing identity is not available: $EXPECTED_IDENTITY" >&2
    exit 1
fi

rm -rf "$DERIVED_DATA_PATH"

xcodebuild \
    -project "$APP_ROOT/Poltergeist.xcodeproj" \
    -scheme Poltergeist \
    -configuration Release \
    -derivedDataPath "$DERIVED_DATA_PATH" \
    -destination "generic/platform=macOS" \
    CLEAN_BUILD=YES \
    CODE_SIGNING_ALLOWED=NO \
    CODE_SIGNING_REQUIRED=NO \
    CODE_SIGN_IDENTITY="" \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    MARKETING_VERSION="$VERSION" \
    CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
    clean build

APP_PATH="$DERIVED_DATA_PATH/Build/Products/Release/Poltergeist.app"
if [[ ! -d "$APP_PATH" ]]; then
    echo "Built app not found: $APP_PATH" >&2
    exit 1
fi

# Xcode leaves a linker ad-hoc signature when signing is disabled. Re-signing the
# bundle replaces it and seals the executable, Info.plist, and all resources.
codesign \
    --force \
    --options runtime \
    --timestamp \
    --sign "$SIGNING_IDENTITY" \
    "$APP_PATH"

"$SCRIPT_DIR/verify-release.sh" --skip-gatekeeper "$APP_PATH"

printf '%s\n' "$APP_PATH"
