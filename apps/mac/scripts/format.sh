#!/bin/bash

# Check or format Swift sources with the project configuration.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v swift-format &> /dev/null; then
    echo "swift-format is not installed; run brew install swift-format" >&2
    exit 1
fi

case "${1:-}" in
    --check)
        swift-format lint --strict --recursive --configuration .swift-format Poltergeist
        ;;
    "")
        swift-format format --in-place --recursive --configuration .swift-format Poltergeist
        ;;
    *)
        echo "Usage: $0 [--check]" >&2
        exit 2
        ;;
esac
