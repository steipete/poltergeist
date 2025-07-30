#!/bin/bash

# Distribution script for Poltergeist Monitor Mac app

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}Distributing Poltergeist Monitor...${NC}"

# Get the directory of this script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Configuration
BUILD_DIR="build"
EXPORT_DIR="export"
ARCHIVE_PATH="$BUILD_DIR/Poltergeist.xcarchive"
APP_NAME="Poltergeist.app"
DMG_NAME="PoltergeistMonitor.dmg"

# Check if archive exists
if [ ! -d "$ARCHIVE_PATH" ]; then
    echo -e "${RED}Archive not found. Please run build.sh first.${NC}"
    exit 1
fi

# Clean export directory
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

# Create export options plist
cat > "$EXPORT_DIR/ExportOptions.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>developer-id</string>
    <key>teamID</key>
    <string>YOUR_TEAM_ID</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
EOF

# Export the archive
echo -e "${YELLOW}Exporting archive...${NC}"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$EXPORT_DIR/ExportOptions.plist"

# Check if export succeeded
if [ ! -d "$EXPORT_DIR/$APP_NAME" ]; then
    echo -e "${RED}Export failed!${NC}"
    exit 1
fi

# Notarize the app (requires valid Developer ID)
echo -e "${YELLOW}Notarizing app...${NC}"
echo -e "${YELLOW}Note: This requires a valid Developer ID certificate and notarization credentials${NC}"

# Create DMG
echo -e "${YELLOW}Creating DMG...${NC}"
rm -f "$EXPORT_DIR/$DMG_NAME"

# Create a temporary directory for DMG contents
DMG_TEMP="$EXPORT_DIR/dmg-temp"
mkdir -p "$DMG_TEMP"
cp -R "$EXPORT_DIR/$APP_NAME" "$DMG_TEMP/"

# Create Applications symlink
ln -s /Applications "$DMG_TEMP/Applications"

# Create DMG
hdiutil create -volname "Poltergeist Monitor" \
  -srcfolder "$DMG_TEMP" \
  -ov -format UDZO \
  "$EXPORT_DIR/$DMG_NAME"

# Clean up
rm -rf "$DMG_TEMP"

echo -e "${GREEN}Distribution complete!${NC}"
echo -e "${GREEN}DMG location: $EXPORT_DIR/$DMG_NAME${NC}"
echo -e "${YELLOW}Note: Remember to notarize the DMG before distribution${NC}"