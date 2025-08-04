#!/bin/bash

# SwiftFormat script for Poltergeist macOS app
# This script runs swift-format with the project configuration

set -e

# Change to the directory containing this script
cd "$(dirname "$0")/.."

# Parse command line arguments
CHECK_ONLY=false
if [[ "$1" == "--check" ]]; then
    CHECK_ONLY=true
fi

# Ensure swift-format is available
if ! command -v swift-format &> /dev/null; then
    echo "❌ swift-format is not installed"
    echo "Install it with: brew install swift-format"
    exit 1
fi

if [ "$CHECK_ONLY" = true ]; then
    echo "🔍 Checking Swift code formatting..."
else
    echo "🎨 Running swift-format..."
fi

# Create logs directory if it doesn't exist
mkdir -p logs

# Count of files to format
file_count=$(find Poltergeist -name "*.swift" -type f | wc -l | xargs)
echo "📝 Found $file_count Swift files to process"

# Run swift-format on all Swift files
issues_found=false
find Poltergeist -name "*.swift" -type f | while read file; do
    if [ "$CHECK_ONLY" = true ]; then
        # Check mode: only verify formatting
        if ! swift-format lint --configuration .swift-format "$file" > /dev/null 2>&1; then
            echo "❌ Formatting issues found in: $file"
            issues_found=true
        fi
    else
        # Format mode: apply changes
        echo "  Formatting: $file"
        if ! swift-format format --configuration .swift-format --in-place "$file" 2>&1 | tee -a logs/swift-format.log; then
            echo "⚠️  Failed to format: $file"
            issues_found=true
        fi
    fi
done

if [ "$CHECK_ONLY" = true ]; then
    if [ "$issues_found" = true ]; then
        echo "❌ Swift code formatting issues found"
        echo "Run './scripts/format.sh' to fix formatting issues"
        exit 1
    else
        echo "✅ All Swift files are properly formatted"
    fi
else
    echo "✅ swift-format completed"
    echo "📝 Full log saved to logs/swift-format.log"
fi