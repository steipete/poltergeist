#!/bin/bash
#
# End-to-End test runner for Poltergeist examples
# Tests minimal config generation and build functionality
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Test counter
PASSED=0
FAILED=0

# Function to print colored output
print_status() {
    local color=$1
    local status=$2
    local message=$3
    echo -e "${color}[${status}]${NC} ${message}"
}

# Function to test a single example
test_example() {
    local dir=$1
    local name=$2
    
    print_status "$BLUE" "TEST" "Testing $name..."
    
    cd "$dir" || {
        print_status "$RED" "FAIL" "Cannot enter directory $dir"
        ((FAILED++))
        return 1
    }
    
    # Clean up from previous runs
    rm -f poltergeist.config.json .poltergeist.log
    rm -rf build dist node_modules 2>/dev/null || true
    
    # Initialize Poltergeist
    print_status "$YELLOW" "INIT" "Running poltergeist init..."
    if [[ "$dir" == *"cmake"* ]]; then
        poltergeist init --cmake > /dev/null 2>&1
    else
        poltergeist init --auto > /dev/null 2>&1
    fi
    
    # Verify minimal config was created
    if [ ! -f poltergeist.config.json ]; then
        print_status "$RED" "FAIL" "Config file not created"
        ((FAILED++))
        cd ..
        return 1
    fi
    
    # Check config is minimal (no default values)
    if grep -q '"settlingDelay": 1000' poltergeist.config.json || \
       grep -q '"useDefaultExclusions": true' poltergeist.config.json || \
       grep -q '"enabled": true' poltergeist.config.json; then
        print_status "$RED" "FAIL" "Config contains default values (not minimal)"
        cat poltergeist.config.json
        ((FAILED++))
        cd ..
        return 1
    fi
    
    # Install dependencies if needed
    if [ -f package.json ]; then
        print_status "$YELLOW" "DEPS" "Installing npm dependencies..."
        npm install --silent > /dev/null 2>&1
    fi
    
    # Start Poltergeist in background
    print_status "$YELLOW" "START" "Starting poltergeist haunt..."
    poltergeist haunt &
    POLTER_PID=$!
    
    # Wait for initial build
    sleep 3
    
    # Check if Poltergeist is running
    if ! kill -0 $POLTER_PID 2>/dev/null; then
        print_status "$RED" "FAIL" "Poltergeist failed to start"
        ((FAILED++))
        cd ..
        return 1
    fi
    
    # Trigger a rebuild by modifying source
    print_status "$YELLOW" "BUILD" "Triggering rebuild..."
    case "$dir" in
        *c-hello*)
            touch main.c
            sleep 2
            # Verify build output exists
            if [ -f hello ]; then
                OUTPUT=$(./hello 2>/dev/null || echo "")
                if [[ "$OUTPUT" == *"Hello from C!"* ]]; then
                    print_status "$GREEN" "PASS" "C build successful"
                    ((PASSED++))
                else
                    print_status "$RED" "FAIL" "Unexpected output: $OUTPUT"
                    ((FAILED++))
                fi
            else
                print_status "$RED" "FAIL" "Build output not found"
                ((FAILED++))
            fi
            ;;
        *node-typescript*)
            touch src/index.ts
            sleep 3
            # Verify TypeScript compiled
            if [ -f dist/index.js ]; then
                OUTPUT=$(node dist/index.js 2>/dev/null || echo "")
                if [[ "$OUTPUT" == *"Hello from TypeScript!"* ]]; then
                    print_status "$GREEN" "PASS" "TypeScript build successful"
                    ((PASSED++))
                else
                    print_status "$RED" "FAIL" "Unexpected output: $OUTPUT"
                    ((FAILED++))
                fi
            else
                print_status "$RED" "FAIL" "TypeScript not compiled"
                ((FAILED++))
            fi
            ;;
        *cmake-library*)
            touch src/math_ops.c
            sleep 3
            # Verify CMake build
            if [ -f build/test_mathlib ]; then
                OUTPUT=$(./build/test_mathlib 2>/dev/null || echo "")
                if [[ "$OUTPUT" == *"Testing MathLib"* ]]; then
                    print_status "$GREEN" "PASS" "CMake build successful"
                    ((PASSED++))
                else
                    print_status "$RED" "FAIL" "Unexpected output: $OUTPUT"
                    ((FAILED++))
                fi
            else
                print_status "$RED" "FAIL" "CMake build not found"
                ((FAILED++))
            fi
            ;;
    esac
    
    # Stop Poltergeist
    kill $POLTER_PID 2>/dev/null || true
    wait $POLTER_PID 2>/dev/null || true
    
    # Clean up
    rm -f poltergeist.config.json .poltergeist.log
    
    cd ..
    echo ""
}

# Main test execution
echo "========================================="
echo "Poltergeist E2E Test Suite"
echo "========================================="
echo ""

# Find and test all example directories
for dir in */; do
    # Skip non-test directories
    if [[ "$dir" =~ ^(c-hello|node-typescript|cmake-library)/ ]]; then
        test_example "$dir" "${dir%/}"
    fi
done

# Summary
echo "========================================="
echo "Test Results:"
echo "  Passed: $PASSED"
echo "  Failed: $FAILED"
echo "========================================="

if [ $FAILED -eq 0 ]; then
    print_status "$GREEN" "SUCCESS" "All tests passed!"
    exit 0
else
    print_status "$RED" "FAILURE" "Some tests failed"
    exit 1
fi