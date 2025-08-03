#!/bin/bash

# Combined SwiftLint and swift-format script for Poltergeist macOS app
# This script formats the code first, then runs linting

set -e

# Change to the directory containing this script
cd "$(dirname "$0")/.."

echo "🚀 Running code quality checks for Poltergeist macOS app"
echo "=================================================="

# Run formatting first
echo ""
echo "Step 1: Formatting code with swift-format..."
if ./scripts/format.sh; then
    echo "✅ Code formatting completed"
else
    echo "❌ Code formatting failed"
    exit 1
fi

echo ""
echo "Step 2: Running SwiftLint..."
if ./scripts/lint.sh; then
    echo "✅ Linting completed"
else
    echo "❌ Linting failed"
    exit 1
fi

echo ""
echo "🎉 All code quality checks passed!"
echo "=================================================="