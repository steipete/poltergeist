#!/bin/bash

# SwiftLint script for Poltergeist macOS app
# This script runs SwiftLint with the project configuration

set -e

# Change to the directory containing this script
cd "$(dirname "$0")/.."

# Ensure SwiftLint is available
if ! command -v swiftlint &> /dev/null; then
    echo "❌ SwiftLint is not installed"
    echo "Install it with: brew install swiftlint"
    exit 1
fi

echo "🔍 Running SwiftLint..."

# Create logs directory if it doesn't exist
mkdir -p logs

# Run SwiftLint with configuration
if swiftlint --config .swiftlint.yml 2>&1 | tee logs/swiftlint.log; then
    echo "✅ SwiftLint completed successfully"
else
    echo "⚠️  SwiftLint found issues - check the output above"
    echo "📝 Full log saved to logs/swiftlint.log"
    exit 1
fi