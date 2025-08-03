#!/bin/bash

# SwiftFormat script for Poltergeist macOS app
# This script runs swift-format with the project configuration

set -e

# Change to the directory containing this script
cd "$(dirname "$0")/.."

# Ensure swift-format is available
if ! command -v swift-format &> /dev/null; then
    echo "❌ swift-format is not installed"
    echo "Install it with: brew install swift-format"
    exit 1
fi

echo "🎨 Running swift-format..."

# Create logs directory if it doesn't exist
mkdir -p logs

# Count of files to format
file_count=$(find Poltergeist -name "*.swift" -type f | wc -l | xargs)
echo "📝 Found $file_count Swift files to format"

# Run swift-format on all Swift files
formatted_count=0
find Poltergeist -name "*.swift" -type f | while read file; do
    echo "  Formatting: $file"
    if swift-format --configuration .swift-format --in-place "$file" 2>&1 | tee -a logs/swift-format.log; then
        ((formatted_count++))
    else
        echo "⚠️  Failed to format: $file"
    fi
done

echo "✅ swift-format completed"
echo "📝 Full log saved to logs/swift-format.log"