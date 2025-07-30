# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Important Rules

### No Version 2 Files
**NEVER create "v2", "Fixed", "Enhanced", "New", or similar duplicate files**. Always work on the existing files directly. When refactoring or improving code:
- Edit files in place
- Make proper refactors to improve the codebase
- Don't create thin wrappers - do complete refactoring
- If a major rewrite is needed, replace the entire file content

### Code Quality
- Focus on clean, maintainable code
- Implement proper abstractions, not quick fixes
- When refactoring, improve the entire system, not just patch issues
- Ensure backwards compatibility when possible

## Project Overview

Poltergeist is a file watcher and auto-builder for development projects. It uses Facebook's Watchman for efficient file watching and supports multiple build targets.

### Key Components
- **State Management**: Unified state files in `/tmp/poltergeist/`
- **Builders**: Modular build system for different target types
- **Watchman Integration**: Efficient file watching
- **CLI**: Command-line interface for user interaction

### Recent Changes
- Migrated from separate lock/status files to unified state system
- State files now include process info, build status, and app metadata
- Implemented heartbeat mechanism for process liveness detection
- Added atomic file operations for reliability

## Development Guidelines

### State File Format
All state is stored in unified JSON files at `/tmp/poltergeist/{projectName}-{hash}-{target}.state`

### Testing
Run tests with: `npm test`

### Building
Build with: `npm run build`