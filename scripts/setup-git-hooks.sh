#!/bin/bash

# Setup script for Git hooks to prevent large file commits
# This script installs pre-commit and pre-push hooks

set -e

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔧 Setting up Git hooks for large file detection...${NC}\n"

# Get the repository root
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
if [ -z "$REPO_ROOT" ]; then
    echo -e "${RED}Error: Not in a Git repository${NC}"
    exit 1
fi

cd "$REPO_ROOT"

# Check if .githooks directory exists
if [ ! -d ".githooks" ]; then
    echo -e "${RED}Error: .githooks directory not found${NC}"
    echo -e "Please ensure the .githooks directory exists with the hook files"
    exit 1
fi

# Make hooks executable
echo -e "${GREEN}✓${NC} Making hooks executable..."
chmod +x .githooks/pre-commit
chmod +x .githooks/pre-push

# Method 1: Configure Git to use .githooks directory (recommended)
echo -e "\n${BLUE}Choose installation method:${NC}"
echo -e "  1) Configure Git to use .githooks directory (recommended)"
echo -e "  2) Copy hooks to .git/hooks directory"
echo -e "  3) Create symbolic links in .git/hooks"
echo -n "Enter choice [1-3]: "
read -r choice

case $choice in
    1)
        echo -e "\n${GREEN}✓${NC} Configuring Git to use .githooks directory..."
        git config core.hooksPath .githooks
        echo -e "${GREEN}✓${NC} Git configured to use .githooks directory"
        echo -e "${YELLOW}Note: This setting is local to this repository${NC}"
        ;;
    2)
        echo -e "\n${GREEN}✓${NC} Copying hooks to .git/hooks directory..."
        
        # Backup existing hooks if they exist
        if [ -f ".git/hooks/pre-commit" ]; then
            echo -e "${YELLOW}⚠${NC}  Backing up existing pre-commit hook to .git/hooks/pre-commit.backup"
            mv .git/hooks/pre-commit .git/hooks/pre-commit.backup
        fi
        if [ -f ".git/hooks/pre-push" ]; then
            echo -e "${YELLOW}⚠${NC}  Backing up existing pre-push hook to .git/hooks/pre-push.backup"
            mv .git/hooks/pre-push .git/hooks/pre-push.backup
        fi
        
        cp .githooks/pre-commit .git/hooks/pre-commit
        cp .githooks/pre-push .git/hooks/pre-push
        chmod +x .git/hooks/pre-commit
        chmod +x .git/hooks/pre-push
        echo -e "${GREEN}✓${NC} Hooks copied to .git/hooks directory"
        ;;
    3)
        echo -e "\n${GREEN}✓${NC} Creating symbolic links in .git/hooks directory..."
        
        # Backup existing hooks if they exist
        if [ -f ".git/hooks/pre-commit" ] || [ -L ".git/hooks/pre-commit" ]; then
            echo -e "${YELLOW}⚠${NC}  Backing up existing pre-commit hook to .git/hooks/pre-commit.backup"
            mv .git/hooks/pre-commit .git/hooks/pre-commit.backup
        fi
        if [ -f ".git/hooks/pre-push" ] || [ -L ".git/hooks/pre-push" ]; then
            echo -e "${YELLOW}⚠${NC}  Backing up existing pre-push hook to .git/hooks/pre-push.backup"
            mv .git/hooks/pre-push .git/hooks/pre-push.backup
        fi
        
        ln -s ../../.githooks/pre-commit .git/hooks/pre-commit
        ln -s ../../.githooks/pre-push .git/hooks/pre-push
        echo -e "${GREEN}✓${NC} Symbolic links created in .git/hooks directory"
        ;;
    *)
        echo -e "${RED}Invalid choice. Exiting.${NC}"
        exit 1
        ;;
esac

echo -e "\n${GREEN}🎉 Git hooks successfully installed!${NC}\n"
echo -e "The hooks will:"
echo -e "  • ${BLUE}Pre-commit${NC}: Check staged files for size > 5MB"
echo -e "  • ${BLUE}Pre-push${NC}: Check all commits being pushed for large files"
echo -e "\nYou can customize the size limit by setting:"
echo -e "  ${YELLOW}export GIT_LARGE_FILE_LIMIT=10${NC} (for 10MB limit)"
echo -e "\nTo bypass hooks in emergency (NOT recommended):"
echo -e "  ${YELLOW}git commit --no-verify${NC}"
echo -e "\n${GREEN}Happy coding! 🚀${NC}"