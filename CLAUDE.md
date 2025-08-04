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

## Swift 6 Concurrency and Dispatch Queue Assertion Failures

### Critical Understanding: Isolation Boundaries and Queue Assertions

**FUNDAMENTAL PRINCIPLE**: In Swift 6, when a callback is annotated with `@MainActor`, the Swift runtime performs queue assertions to verify that the code is actually running on the main dispatch queue. If the callback is invoked from a background queue (like DispatchSource event handlers), you get `_dispatch_assert_queue_fail` crashes.

**The Problem**: 
- FileWatcher uses DispatchSource on background queue (`com.poltergeist.filewatcher`)  
- Callback was declared as `@MainActor @Sendable () -> Void`
- When DispatchSource fires, it tries to call the `@MainActor` callback from background queue
- Swift runtime performs queue assertion and fails: "This code should run on main queue but it's running on background queue!"

**Wrong Solutions**: 
- ❌ Using `Task { @MainActor in ... }` - Still fails because the Task creation itself triggers the assertion
- ❌ Using `DispatchQueue.main.async { Task { @MainActor in ... } }` - Overly complex and unnecessary

**Correct Solution**:
- ✅ Remove `@MainActor` from callback signature: `@Sendable () -> Void`  
- ✅ Use `DispatchQueue.main.async { callback() }` to manually ensure main queue execution
- ✅ Let the callback implementation handle any `@MainActor` requirements via `Task { @MainActor in ... }`

**Key Insight**: The callback dispatch mechanism must guarantee main queue execution BEFORE any `@MainActor` annotations take effect. By the time you have `@MainActor` annotations, Swift expects you're already on the main queue - using Task at that point is too late and triggers the assertion failure.

This is a Swift 6 concurrency isolation boundary issue where mixing dispatch queues with Swift concurrency requires careful queue management at the interface level.