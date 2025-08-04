#!/bin/bash

# Generate Swift Documentation using Swift-DocC
# This script generates comprehensive API documentation for the macOS Poltergeist app

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory and project paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DOCS_OUTPUT_DIR="$PROJECT_DIR/../../../docs/api/swift"

echo -e "${BLUE}🏗️  Generating Swift API Documentation${NC}"
echo -e "${BLUE}Project: ${PROJECT_DIR}${NC}"
echo -e "${BLUE}Output:  ${DOCS_OUTPUT_DIR}${NC}"

# Create output directory
mkdir -p "$DOCS_OUTPUT_DIR"

# Change to project directory
cd "$PROJECT_DIR"

# Clean any existing documentation builds
echo -e "${YELLOW}🧹 Cleaning previous documentation builds...${NC}"
rm -rf "$DOCS_OUTPUT_DIR"/*

# Check if we have xcodebuild available
if ! command -v xcodebuild &> /dev/null; then
    echo -e "${RED}❌ xcodebuild not found. Please install Xcode.${NC}"
    exit 1
fi

# Generate documentation using xcodebuild docbuild
echo -e "${YELLOW}📚 Building documentation with Swift-DocC...${NC}"

# Build documentation for the Poltergeist scheme
xcodebuild docbuild \
    -project "Poltergeist.xcodeproj" \
    -scheme "Poltergeist" \
    -destination "generic/platform=macOS" \
    -derivedDataPath "./DerivedData" \
    OTHER_SWIFT_FLAGS="-Xfrontend -warn-long-function-bodies=500 -Xfrontend -warn-long-expression-type-checking=500"

# Find the generated documentation archive
DOCC_ARCHIVE=$(find "./DerivedData" -name "*.doccarchive" -type d | head -1)

if [ -z "$DOCC_ARCHIVE" ]; then
    echo -e "${RED}❌ No .doccarchive found. Documentation generation may have failed.${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Found documentation archive: $DOCC_ARCHIVE${NC}"

# Convert to static website
echo -e "${YELLOW}🌐 Converting to static website...${NC}"

# Use docc to convert the archive to a static site
if command -v docc &> /dev/null; then
    docc process-archive \
        transform-for-static-hosting \
        "$DOCC_ARCHIVE" \
        --output-path "$DOCS_OUTPUT_DIR" \
        --hosting-base-path "/poltergeist/api/swift"
else
    echo -e "${YELLOW}⚠️  docc command not found, copying archive directly...${NC}"
    cp -R "$DOCC_ARCHIVE" "$DOCS_OUTPUT_DIR/"
fi

# Clean up derived data
echo -e "${YELLOW}🧹 Cleaning up temporary files...${NC}"
rm -rf "./DerivedData"

# Create an index.html redirect for easier access
cat > "$DOCS_OUTPUT_DIR/index.html" << EOF
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Poltergeist Swift API Documentation</title>
    <meta http-equiv="refresh" content="0; url=./documentation/poltergeist/">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
        }
        .container {
            text-align: center;
            padding: 2rem;
            background: rgba(255, 255, 255, 0.1);
            border-radius: 1rem;
            backdrop-filter: blur(10px);
        }
        .spinner {
            border: 4px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top: 4px solid white;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 0 auto 1rem;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        a {
            color: white;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="spinner"></div>
        <h1>Poltergeist Swift API Documentation</h1>
        <p>Redirecting to documentation...</p>
        <p><a href="./documentation/poltergeist/">Click here if you are not redirected automatically</a></p>
    </div>
</body>
</html>
EOF

echo -e "${GREEN}✅ Swift documentation generated successfully!${NC}"
echo -e "${GREEN}📍 Location: $DOCS_OUTPUT_DIR${NC}"
echo -e "${GREEN}🌐 Open: file://$DOCS_OUTPUT_DIR/index.html${NC}"

# Show some usage information
echo -e "\n${BLUE}📖 Documentation Usage:${NC}"
echo -e "${BLUE}• Open index.html in your browser to view the documentation${NC}"
echo -e "${BLUE}• Documentation includes all public APIs with Swift-DocC formatting${NC}"
echo -e "${BLUE}• Use 'npm run docs:serve' from project root to serve all documentation${NC}"