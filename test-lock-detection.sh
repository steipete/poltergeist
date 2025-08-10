#!/bin/bash

# Test script for generic lock detection feature

echo "Testing Poltergeist Generic Lock Detection..."

# Create a test directory
TEST_DIR="/tmp/test-lock-detection-$$"
mkdir -p "$TEST_DIR"
cd "$TEST_DIR"

# Create a simple config
cat > poltergeist.config.json << 'EOF'
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "test-app",
      "type": "executable",
      "enabled": true,
      "buildCommand": "sleep 5 && echo 'Build complete'",
      "outputPath": "./test-app",
      "watchPaths": ["src/**"],
      "excludePaths": []
    }
  ]
}
EOF

# Create a dummy source file
mkdir -p src
echo "console.log('test');" > src/index.js

echo "1. Testing lock file detection during build..."

# Start poltergeist in background
poltergeist start &
POLTER_PID=$!

# Wait for daemon to start
sleep 2

# Trigger a build by touching a file
touch src/index.js

# Check if lock file exists
sleep 1
LOCK_FILE=$(ls /tmp/poltergeist/*test-app.lock 2>/dev/null | head -1)
if [ -n "$LOCK_FILE" ]; then
    echo "✓ Lock file created: $LOCK_FILE"
else
    echo "✗ Lock file not found"
fi

# Try to run polter while build is in progress
echo "2. Testing polter detection of active lock..."
polter test-app 2>&1 | grep -q "lock\|wait\|building" && echo "✓ Polter detected active build" || echo "✗ Polter did not detect lock"

# Wait for build to complete
sleep 5

# Check if lock file is removed
if [ ! -f "$LOCK_FILE" ]; then
    echo "✓ Lock file removed after build"
else
    echo "✗ Lock file still exists after build"
fi

# Clean up
poltergeist stop
kill $POLTER_PID 2>/dev/null
rm -rf "$TEST_DIR"

echo "Test complete!"