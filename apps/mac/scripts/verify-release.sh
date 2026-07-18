#!/bin/bash

set -euo pipefail

readonly EXPECTED_BUNDLE_ID="me.steipete.poltergeist.monitor"
readonly EXPECTED_AUTHORITY="Developer ID Application: Peter Steinberger (Y5PE65HELJ)"
readonly EXPECTED_TEAM_ID="Y5PE65HELJ"
readonly STABLE_REQUIREMENT="identifier \"$EXPECTED_BUNDLE_ID\" and anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"$EXPECTED_TEAM_ID\""

usage() {
    echo "Usage: $0 [--skip-gatekeeper] <Poltergeist.app>" >&2
    exit 2
}

SKIP_GATEKEEPER=0
if [[ "${1:-}" == "--skip-gatekeeper" ]]; then
    SKIP_GATEKEEPER=1
    shift
fi
[[ $# -eq 1 ]] || usage

APP_PATH="$1"
[[ -d "$APP_PATH" ]] || { echo "App not found: $APP_PATH" >&2; exit 1; }

BUNDLE_ID="$(plutil -extract CFBundleIdentifier raw "$APP_PATH/Contents/Info.plist")"
if [[ "$BUNDLE_ID" != "$EXPECTED_BUNDLE_ID" ]]; then
    echo "Unexpected bundle identifier: $BUNDLE_ID" >&2
    exit 1
fi

SIGNATURE_DETAILS="$(codesign -dvvv "$APP_PATH" 2>&1)"
grep -Fq "Authority=$EXPECTED_AUTHORITY" <<< "$SIGNATURE_DETAILS" || {
    echo "App is not signed by $EXPECTED_AUTHORITY" >&2
    exit 1
}
grep -Fq "TeamIdentifier=$EXPECTED_TEAM_ID" <<< "$SIGNATURE_DETAILS" || {
    echo "Unexpected or missing TeamIdentifier" >&2
    exit 1
}
grep -Eq 'flags=.*\(runtime\)' <<< "$SIGNATURE_DETAILS" || {
    echo "Hardened runtime flag is missing" >&2
    exit 1
}

codesign --verify --strict --deep --verbose=2 "$APP_PATH"
codesign --verify --strict --deep --verbose=2 -R="$STABLE_REQUIREMENT" "$APP_PATH"

if [[ $SKIP_GATEKEEPER -eq 0 ]]; then
    spctl --assess --type execute --verbose=4 "$APP_PATH"
fi

codesign -d -r- "$APP_PATH" 2>&1
