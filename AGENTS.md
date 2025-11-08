# AGENTS.md

This file provides guidance to all coding agents (Claude, GPT, etc.) working in this repository.

## Runtime Guardrails

- When using tmux, avoid polling loops like `while tmux has-session …`.
- Launch tmux commands directly, then issue follow-up commands (e.g. `tmux capture-pane`) without wait loops.
- Skip `tmux wait-for`; allow sessions to exit naturally before querying results.
- NEVER SLEEP LONGER THAN 30 sec.
- `pnpm run poltergeist:haunt` must spawn the daemon and return immediately. If it blocks, treat that as a regression—start the helper and then inspect progress via `poltergeist status` / `poltergeist logs` rather than tailing the launch command itself.

## Claude-Specific Notes

## Changelog Style Guide

**CRITICAL**: Always maintain consistent, professional one-line style in CHANGELOG.md

### Format Rules
1. **READ EXISTING ENTRIES FIRST** - Match the existing style exactly
2. **One-line entries** - Each change is a single, concise bullet point
3. **No subsections** - Don't use "### Features", "### Breaking Changes", etc.
4. **Professional tone** - Direct, technical language without marketing speak
5. **Specific details** - Include technical specifics, not vague descriptions

### Example Format
```markdown
## [1.8.0] - 2025-08-09

- Target-specific log files in `/tmp/poltergeist/` with plain text format (80% size reduction)
- Separate log file per target matching state file naming: `{projectName}-{hash}-{target}.log`
- Fixed Bun.spawn stdio configuration error - daemon now starts correctly
```

**NOT THIS** (verbose, subsectioned style):
```markdown
### Breaking Changes
- **New logging system**: Separate log files per target...

### Features
- Target-specific log files...
```

## Logging System (v1.8.0+)

**BREAKING CHANGE**: Poltergeist v1.8.0+ uses separate log files per target with plain text format.

### Log File Structure
- **Location**: `/tmp/poltergeist/` directory (same as state files)
- **Naming**: `{projectName}-{hash}-{target}.log` (matches state file pattern)
- **Format**: Plain text with simple structure: `timestamp level: message`
- **One log per build**: Each build creates a fresh log file (no rotation)

### Benefits
- **80% size reduction** compared to JSON format
- **Zero parsing overhead** for reading logs
- **Natural filtering** - each target has its own file
- **No redundancy** - target name never written in logs

### Backward Compatibility
- **NOT MAINTAINED**: Old JSON log format is not supported
- Migration is automatic - new builds use new format
- The `logs` command can still read old JSON logs if they exist

## Homebrew Release Process

**CRITICAL**: Poltergeist is distributed as a pre-compiled Bun executable, NOT as a Node.js package.

### Release Steps:
1. **Build Bun binary**: Run `npm run build:bun` to create standalone executable
2. **Create tarball**: Package the binary as `poltergeist-macos-{arch}-v{version}.tar.gz`
3. **GitHub Release**: Upload the tarball to GitHub releases
4. **Homebrew Formula**: Download from GitHub releases, NOT from npm registry

### Homebrew Formula Pattern:
```ruby
class Poltergeist < Formula
  desc "Universal file watcher with auto-rebuild"
  homepage "https://github.com/steipete/poltergeist"
  url "https://github.com/steipete/poltergeist/releases/download/v{VERSION}/poltergeist-macos-universal.tar.gz"
  sha256 "..."
  
  def install
    bin.install "poltergeist"
    bin.install "polter"
  end
end
```

**NO Node.js dependency, NO npm installation, just direct binary installation.**

## Bun Compilation Limitations & Workarounds

### Known Issues with `bun build --compile`

1. **Dynamic imports break compilation**
   - `await import('@module')` fails in compiled binaries
   - **Solution**: Use static `require()` with try/catch for optional dependencies

2. **`import.meta` breaks bytecode compilation**
   - `import.meta.url`, `import.meta.dir`, `import.meta.main` cause "Failed to generate bytecode"
   - **Solution**: Created `utils/paths.ts` with runtime detection using `eval('import.meta.url')`

3. **Bun shell breaks bytecode**
   - `import { $ } from "bun"` prevents bytecode compilation
   - **Solution**: Use `spawnSync` from child_process instead

4. **Daemon spawning issues**
   - `Bun.spawn()` doesn't work reliably for daemon processes in standalone binaries
   - `process.argv[0]` is always "bun" in compiled executables
   - **Solution**: Use regular `spawn()` with detached flag and `process.execPath`

5. **Module resolution in compiled binaries**
   - Dynamically imported modules aren't included in the virtual filesystem
   - **Solution**: Ensure all critical modules use static imports

### Best Practices for Bun Compilation
- Always test with `--bytecode` flag for better startup performance
- Use `process.execPath` instead of `process.argv[0]` for binary path
- Avoid top-level await in modules that will be compiled
- Use runtime feature detection instead of compile-time checks

## Self-Building with Poltergeist

Poltergeist can build itself! The project includes a `poltergeist.config.json` that watches its own source files.

### Setup
```bash
# First time only - create initial build
npm run build

# Start Poltergeist to watch itself
poltergeist start

# That's it! Any changes to src/ will trigger rebuilds
```

### Using polter for fresh builds
When working on Poltergeist itself, always use `polter` to ensure fresh binaries:
```bash
# Instead of: ./dist/cli.js
# Use: polter poltergeist-cli

# This ensures you're always running the latest build
polter poltergeist-cli status
```

### Important for AI Agents
- **NEVER manually run `npm run build`** when Poltergeist is running
- **ALWAYS use `polter poltergeist-cli`** to run commands
- Poltergeist detects its own changes and rebuilds automatically
- The Mac app (poltergeist-mac target) also rebuilds automatically when enabled

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

### File Headers
- Use minimal file headers without "Created by" or date comments
- Format: `//\n//  FileName.swift\n//  Poltergeist\n//`
- Omit author attribution and creation dates

## Project Overview

Poltergeist is a file watcher and auto-builder for development projects. It uses Facebook's Watchman for efficient file watching and supports multiple build targets.

### System Requirements
- **macOS**: 14.0+ (for SwiftUI Settings support)
- **iOS**: Not supported - macOS only app
- **Architecture**: Universal (Apple Silicon + Intel)

### SwiftUI Settings Implementation
- Use `SettingsLink` for all settings access (macOS 14+ only)
- No legacy Objective-C selectors (`showSettingsWindow:`, `showPreferencesWindow:`)
- Settings window is handled entirely by SwiftUI's `Settings` scene

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

## Development Commands

### CLI Development
```bash
# Core development workflow
npm run build              # Compile TypeScript to dist/
npm test                   # Run Vitest test suite
npm run dev               # Development mode with hot reload
npm run typecheck         # TypeScript type checking
npm run lint              # Biome linting and formatting checks
npm run lint:fix          # Auto-fix linting issues
npm run format            # Format code with Biome

# Documentation generation
npm run docs:build        # Generate all documentation (TypeScript + Swift)
npm run docs:api          # Generate TypeScript API docs only
npm run docs:swift        # Generate Swift API docs only
npm run docs:serve        # Serve documentation on localhost:8080

# Single test execution
npm test -- --run <test-name>     # Run specific test file
npm test -- --watch              # Watch mode for tests
```

### macOS App Development
```bash
cd apps/mac

# Building and testing
./scripts/build.sh        # Build the macOS app
./scripts/test.sh         # Run Swift tests
./scripts/lint.sh         # SwiftLint checks
./scripts/format.sh       # swift-format code formatting

# Xcode development
open Poltergeist.xcodeproj
# Or build via command line:
xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist build
```

## Architecture Overview

### Dual-Platform Design
Poltergeist consists of two complementary applications:

1. **Node.js CLI Tool** (`src/`): Cross-platform file watcher and build engine
2. **macOS Native App** (`apps/mac/`): SwiftUI status bar monitor and GUI

Communication happens through **shared state files** in `/tmp/poltergeist/` - not direct IPC.

### Core CLI Components

#### Central Engine (`src/poltergeist.ts`)
- Orchestrates file watching, build queue, and target management
- Uses dependency injection pattern with `PoltergeistDependencies`
- Manages target lifecycle and state coordination

#### Build System Architecture
- **IntelligentBuildQueue** (`src/build-queue.ts`): Manages parallel builds with priority scoring
- **PriorityEngine** (`src/priority-engine.ts`): Analyzes user focus patterns for smart build ordering
- **Builder Factory** (`src/factories.ts`): Creates target-specific builders (executable, app-bundle, library, etc.)
- **Individual Builders** (`src/builders/`): Handle target-specific build logic and validation

#### File Watching & Configuration
- **WatchmanClient** (`src/watchman.ts`): Facebook Watchman integration with subscription management
- **WatchmanConfigManager** (`src/watchman-config.ts`): Auto-generates `.watchmanconfig` with smart exclusions
- **ConfigLoader** (`src/config.ts`): Zod-based schema validation and configuration migration

#### State Management System
- **StateManager** (`src/state.ts`): Atomic file operations for inter-process coordination
- **Unified state files**: `/tmp/poltergeist/{projectName}-{hash}-{target}.state`
- **Lock-free design**: Uses atomic write operations (temp file + rename)
- **Heartbeat monitoring**: Process liveness detection with automatic cleanup

### macOS App Architecture

#### SwiftUI + Observable Pattern
- **ProjectMonitor** (`Services/ProjectMonitor.swift`): Main actor that watches state directory
- **@Observable** pattern throughout for reactive UI updates
- **@MainActor** classes ensure thread safety

#### Key Components
- **StatusBarController**: Menu bar integration and user interaction
- **FileWatcher**: Monitors `/tmp/poltergeist/` for state file changes
- **NotificationManager**: Native macOS notifications for build events
- **IconLoader**: Dynamically loads app icons from project configurations

### Target System Architecture

#### Target Types & Builders
The system supports 7 target types, each with specialized builders:

- **executable**: CLI tools, binaries (`ExecutableBuilder`)
- **app-bundle**: macOS/iOS apps with bundle management (`AppBundleBuilder`) 
- **library**: Static/dynamic libraries (`LibraryBuilder`)
- **framework**: Apple frameworks (`FrameworkBuilder`)
- **test**: Test suites (`TestBuilder`)
- **docker**: Container images (`DockerBuilder`)
- **custom**: User-defined builds (`CustomBuilder`)

Each builder implements `BaseBuilder` interface with target-specific validation and execution logic.

### State File Format
All state is stored in unified JSON files at `/tmp/poltergeist/{projectName}-{hash}-{target}.state`:

```json
{
  "version": "1.0",
  "projectPath": "/path/to/project",
  "projectName": "my-project", 
  "target": "my-target",
  "process": {
    "pid": 12345,
    "isActive": true,
    "startTime": "2024-01-01T00:00:00.000Z",
    "lastHeartbeat": "2024-01-01T00:01:00.000Z"
  },
  "lastBuild": {
    "status": "success|failure|building|idle",
    "timestamp": "2024-01-01T00:00:30.000Z",
    "gitHash": "abc123",
    "buildTime": 2.5,
    "errorSummary": "Optional error message"
  },
  "appInfo": {
    "bundleId": "com.example.myapp",
    "outputPath": "/path/to/output",
    "iconPath": "/path/to/icon.png"
  }
}
```

## Poltergeist Mac App Usage

### Setup and Configuration
The Mac app requires a `poltergeist.config.json` file in your project root. Example for Swift projects:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "debug",
      "type": "executable", 
      "enabled": true,
      "buildCommand": "xcodebuild -project MyApp.xcodeproj -scheme MyApp -configuration Debug build",
      "watchPaths": [
        "Sources/**/*.swift",
        "Tests/**/*.swift", 
        "*.xcodeproj/**"
      ],
      "settlingDelay": 1000,
      "debounceInterval": 3000
    }
  ],
  "notifications": {
    "enabled": true,
    "buildSuccess": true,
    "buildFailed": true,
    "icon": "./path/to/your/app/icon.png"
  }
}
```

### Starting Poltergeist
1. **CLI**: Run `poltergeist` in your project directory 
2. **Mac App**: Will automatically detect and monitor configured projects

### File Watching
- Uses Facebook's Watchman for efficient file system monitoring
- Automatically ignores build artifacts, `.DS_Store`, Xcode user data
- Configurable watch patterns per target
- Debouncing prevents excessive builds from rapid file changes

### Build Process
- Incremental compilation when possible
- Build times typically 1.5-3.5 seconds for Swift projects
- Automatic retry on transient failures
- Real-time build status in Mac app status bar

### Testing Integration
Poltergeist works with standard project scripts:
- `scripts/lint.sh` - SwiftLint integration
- `scripts/format.sh` - swift-format integration  
- `scripts/test.sh` - Swift Testing validation

### State Management
- State files stored in `/tmp/poltergeist/`
- Format: `{projectName}-{hash}-{target}.state`
- Contains build status, process info, heartbeat data
- Automatic cleanup of stale projects

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
