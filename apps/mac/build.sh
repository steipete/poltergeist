#!/bin/bash

# Build script for Poltergeist Monitor Mac app

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Building Poltergeist Monitor...${NC}"

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Build configuration
CONFIGURATION="${1:-Release}"
SCHEME="Poltergeist"
PROJECT="Poltergeist.xcodeproj"
BUILD_DIR="build"

# Clean previous builds
echo -e "${YELLOW}Cleaning previous builds...${NC}"
rm -rf "$BUILD_DIR"

# Build the archive
echo -e "${YELLOW}Building $CONFIGURATION archive...${NC}"
xcodebuild -project "$PROJECT" \
  -scheme "$SCHEME" \
  -configuration "$CONFIGURATION" \
  -archivePath "$BUILD_DIR/Poltergeist.xcarchive" \
  -destination "generic/platform=macOS" \
  clean archive

# Check if build succeeded
if [ $? -eq 0 ]; then
    echo -e "${GREEN}Build succeeded!${NC}"
    echo -e "${GREEN}Archive location: $BUILD_DIR/Poltergeist.xcarchive${NC}"
else
    echo -e "${RED}Build failed!${NC}"
    exit 1
fi