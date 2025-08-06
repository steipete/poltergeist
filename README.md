<div align="center">
  <img src="assets/poltergeist-logo.png" alt="Poltergeist Logo" width="200">
  
  # Poltergeist

  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"></a>
  <a href="https://github.com/steipete/poltergeist"><img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge" alt="Platforms"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/steipete/poltergeist/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/steipete/poltergeist/ci.yml?style=for-the-badge&logo=github&label=CI" alt="CI Status"></a>

  **The ghost that keeps your builds fresh** 👻  
  A universal file watcher with auto-rebuild for any language or build system
</div>

Poltergeist is an AI-friendly universal file-watcher that auto-detects any project and rebuilds them as soon as a file has been changed. Think `npm run dev` for native apps, with automatic configuration, notifications and a smart build queue. It stands on the shoulders of [giants](https://facebook.github.io/watchman/) and fills the glue layer that's been missing.

Works on macOS, Linux, and Windows. Available as a standalone binary (no Node.js required) or npm package.

> **📖 Read the story behind Poltergeist**: [The Ghost That Keeps Your Builds Fresh](https://steipete.me/posts/2025/poltergeist-ghost-keeps-builds-fresh) - Learn how this tool was built using Claude Code and why it's designed to accelerate both human and AI development workflows.

## Installation

### Homebrew (macOS, ARM64)

```bash
brew tap steipete/tap
brew install poltergeist
```

### npm (all platforms)

```bash
npm install -g @steipete/poltergeist
```

### Requirements

Poltergeist requires [Watchman](https://facebook.github.io/watchman/) to be installed:
  - **macOS**: `brew install watchman`
  - **Linux**: [Installation guide](https://facebook.github.io/watchman/docs/install#linux)
  - **Windows**: [Chocolatey package](https://facebook.github.io/watchman/docs/install#windows) or manual install

Poltergeist offers both a **CLI tool** for universal development and a **native macOS app** for enhanced monitoring (coming soon).

## Features

- **Universal Target System**: Support for anything you can build - executables, app bundles, libraries, frameworks, tests, Docker containers, ...
- **Smart Execution Wrapper**: `polter` command that waits for a build to complete, then starts it
- **Efficient File Watching**: Powered by Facebook's Watchman with smart exclusions and performance optimization
- **Intelligent Build Prioritization**: Having multiple projects that share code? Polgergeist will compile the right one first, based on which files you edited in the past
- **Automatic Project Configuration**: Just type `poltergeist init` and it'll parse your folder and set up the config.
- **Native Notifications**: System notifications with customizable sounds and icon for build status
- **Concurrent Build Protection**: Intelligent locking prevents overlapping builds
- **Advanced State Management**: Process tracking, build history, and heartbeat monitoring
- **Automatic Configuration Reloading**: Changes to `poltergeist.config.json` are detected and applied without manual restart

## Designed for Humans and Agents

Polgergeist has been designed with an agentic workflow in mind. As soon as your agent starts editing files, we'll start a background compile process. Further edits will cancel and re-compile as needed. Since agents are relatively slow, there's a good chance your project already finished compiling before the agent tries to even run it. Benefits:

- Agents don't have to call build manually anymore
- They call your executable directly with `polter` as prefix, which waits until the build is complete.
- Faster loops, fewer wasted tokens

Commands have been designed with the least surprises, the cli works just like what agents expect, and there's plenty aliases so things will just work, even if your agent gets confused.

Examples:
- `haunt` is used to start the daemon, but `start` is also a valid alias
- Commands that are executed in a non-tty environment have added helpful messages for agents
- Fuzzy matching will find targets even if they are misspelled
- Build time is tracked, so agents can set their timeout correctly for waiting
- Commands are token conservative by default and don't emit the full build log

## Quick Start

### Installation

Install globally via npm:

```bash
npm install -g @steipete/poltergeist
```

### Basic Usage

1. **Automatic Configuration** - Let Poltergeist analyze your project:

```bash
poltergeist init
```

This automatically detects your project type (Swift, Node.js, Rust, Python, CMake, etc.) and creates an optimized configuration.

2. **Start Watching** - Begin auto-building on file changes:

```bash
poltergeist haunt        # Runs as background daemon (default)
poltergeist status       # Check what's running
```


3. **Execute Fresh Builds** - Use `polter` to ensure you never run stale code:

```bash
polter my-app            # Waits for build, then runs fresh binary
polter my-app --help     # All arguments passed through
```

That's it! Poltergeist now watches your files and rebuilds automatically.

Each project gets its own background process, but `poltergeist status` shows everything through a shared state system in `/tmp/poltergeist/`. One project crashing never affects others.

## Table of Contents

- [Features](#features)
- [Designed for Humans and Agents](#designed-for-humans-and-agents)
- [Quick Start](#quick-start)
- [Command Line Interface](#command-line-interface)
  - [Core Commands](#core-commands-poltergeist)
  - [Smart Execution](#smart-execution-with-polter)
- [Configuration](#configuration)
  - [Automatic Detection](#automatic-project-detection)
  - [Configuration Schema](#configuration-schema)
  - [Target Types](#target-types)
  - [Watch Patterns](#watch-path-patterns)
- [Advanced Features](#advanced-features)
  - [Smart Defaults](#smart-defaults)
  - [CMake Support](#cmake-support)
  - [Performance Profiles](#performance-profiles)
  - [Build Prioritization](#intelligent-build-prioritization)
- [Architecture](#architecture)
- [Examples](#examples)
- [Development](#development)
- [License](#license)

## Command Line Interface

Poltergeist provides two main commands: `poltergeist` for managing the file watcher daemon, and `polter` for executing fresh builds.

### Core Commands (poltergeist)

#### Starting and Managing the Daemon

```bash
# Start watching (runs as background daemon by default)
poltergeist haunt
poltergeist start         # Alias for haunt

# Check what's running
poltergeist status        # Shows all active projects and their build status

# View build logs
poltergeist logs          # Recent logs
poltergeist logs -f       # Follow logs in real-time

# Stop watching
poltergeist stop          # Stop all targets
poltergeist stop --target my-app  # Stop specific target
```

#### Project Management

```bash
# Initialize configuration
poltergeist init          # Auto-detect and create config
poltergeist init --cmake  # Specialized CMake detection

# List configured targets
poltergeist list          # Shows all targets and their status

# Clean up old state files
poltergeist clean         # Remove stale state files
poltergeist clean --all   # Remove all state files
```

### Smart Execution with polter

The `polter` command ensures you always run fresh builds:

```bash
# Basic usage
polter <target-name> [arguments...]

# Examples
polter my-app                    # Run after build completes
polter my-app --port 8080       # All arguments passed through
polter backend serve --watch    # Complex commands work too

# Options
polter my-app --timeout 60000   # Wait up to 60 seconds
polter my-app --force           # Run even if build failed
polter my-app --verbose         # Show build progress
```

**How it works:**
1. Checks if target is currently building
2. Waits for build to complete (with progress updates)
3. Fails immediately if build failed
4. Executes the fresh binary with your arguments

### Daemon Mode Details

Since v1.4.0, Poltergeist runs as a **daemon by default**:

- **Non-blocking**: Returns control immediately
- **Background builds**: Continues watching/building after terminal closes
- **Multi-project**: Each project runs independently
- **Persistent logs**: Access logs anytime with `poltergeist logs`

To run in traditional foreground mode:
```bash
poltergeist haunt --foreground   # Blocks terminal, shows output directly
```

### Command Reference

| Command | Description | Example |
|---------|-------------|---------|
| `haunt` / `start` | Start watching and building | `poltergeist haunt --target frontend` |
| `stop` / `rest` | Stop the daemon | `poltergeist stop` |
| `restart` | Restart the daemon | `poltergeist restart` |
| `status` | Show build status | `poltergeist status --json` |
| `logs` | View daemon logs | `poltergeist logs -f -n 100` |
| `list` | List all targets | `poltergeist list` |
| `init` | Create configuration | `poltergeist init --cmake` |
| `clean` | Clean state files | `poltergeist clean --dry-run` |
| `polter` | Execute fresh builds | `polter my-app --help` |

## Configuration

Poltergeist can automatically detect and configure most projects, but also supports detailed manual configuration.

### Automatic Project Detection

Run `poltergeist init` to automatically:
- Detect project type (Swift, Node.js, Rust, Python, CMake, etc.)
- Find build commands and output paths
- Configure optimal watch patterns
- Set up smart exclusions
- Generate `poltergeist.config.json`

Project detection looks for:
- `Package.swift` → Swift Package Manager
- `package.json` → Node.js/npm
- `Cargo.toml` → Rust/Cargo
- `CMakeLists.txt` → CMake projects
- `pyproject.toml` → Python projects
- And more...

### Configuration Schema

Essential configuration structure:

```json
{
  "version": "1.0",
  "projectType": "swift|node|rust|python|cmake|mixed",
  "targets": [
    {
      "name": "my-app",
      "type": "executable|app-bundle|library|framework|test|docker|custom",
      "buildCommand": "cargo build --release",
      "outputPath": "./target/release/myapp",
      "watchPaths": ["src/**/*.rs"]
    }
  ],
  "buildScheduling": { "parallelization": 2 },
  "notifications": { "enabled": true }
}
```

### Target Types

Poltergeist supports multiple target types with specific optimizations:

| Type | Use Case | Key Properties |
|------|----------|----------------|
| `executable` | CLI tools, binaries | `outputPath`, standard execution |
| `app-bundle` | macOS/iOS apps | `bundleId`, `autoRelaunch`, app lifecycle |
| `library` | Static/dynamic libs | `libraryType`, linking optimization |
| `framework` | macOS/iOS frameworks | Platform-specific builds |
| `test` | Test suites | `testCommand`, `coverageFile` |
| `docker` | Containerized apps | `imageName`, `dockerfile`, `tags` |
| `custom` | Custom builds | Flexible `config` object |
| `cmake-executable` | CMake executables | `targetName`, `generator`, `buildType` |
| `cmake-library` | CMake libraries | `targetName`, `libraryType`, `generator` |
| `cmake-custom` | CMake custom targets | `targetName`, custom CMake commands |

### Watch Path Patterns

Poltergeist supports glob patterns with brace expansion for more compact configurations:

#### Basic Patterns
```json
"watchPaths": [
  "src/**/*.swift",           // All Swift files recursively
  "**/*.{js,ts}",            // All JavaScript and TypeScript files
  "tests/**/*Test.swift"      // Test files with specific naming
]
```

#### Brace Expansion
Reduce repetition with brace expansion patterns:
```json
// Instead of:
"watchPaths": [
  "src/**/*.c",
  "src/**/*.cpp", 
  "src/**/*.h"
]

// Use:
"watchPaths": [
  "src/**/*.{c,cpp,h}"      // All C/C++ source and header files
]
```

#### Advanced Examples
```json
"watchPaths": [
  // Multiple extensions
  "src/**/*.{swift,m,h}",                    // Swift and Objective-C
  "{src,include}/**/*.{c,cpp,h}",           // Multiple directories
  "frontend/**/*.{ts,tsx,js,jsx,css}",      // Web assets
  
  // Multiple file patterns
  "{CMakeLists.txt,CMakePresets.json}",     // Specific files
  "config/{package,tsconfig}.json",         // Config files
  "**/*.{yaml,yml}",                        // YAML files
  
  // Complex patterns
  "{src,test}/**/*.{c,cpp,h}",             // Source and test dirs
  "apps/{mac,ios}/**/*.swift",              // Platform-specific
  "**/{Makefile,*.mk}"                      // Make files
]
```

### Smart Defaults

Poltergeist uses sensible defaults to keep configurations minimal. Only specify what differs from defaults:

#### Default Values (don't specify these):
- `enabled: true` - Targets are enabled by default
- `settlingDelay: 1000` - 1 second delay before building
- `debounceInterval: 3000` - 3 seconds between builds
- `useDefaultExclusions: true` - Standard exclusions enabled
- `profile: "balanced"` - Balanced performance profile
- `autoOptimize: true` - Performance optimization enabled
- `notifications.enabled: true` - Notifications are on
- `buildStart: false` - No notification on build start
- `buildSuccess: true` - Notify on successful builds
- `buildFailed: true` - Notify on failed builds

#### Only Specify What's Different:
```json
{
  "targets": [{
    "name": "my-app",
    "buildCommand": "./build.sh",
    "watchPaths": ["src/**/*.{c,h}"],
    "settlingDelay": 2000  // Only if you need 2s instead of default 1s
  }]
}
```

<details>
<summary>Example target configurations</summary>

```json
{
  "targets": [
    {
      "name": "cli-tool",
      "type": "executable",
      "buildCommand": "cargo build --release",
      "outputPath": "./target/release/myapp"
    },
    {
      "name": "mac-app",
      "type": "app-bundle",
      "buildCommand": "xcodebuild -scheme MyApp",
      "bundleId": "com.example.myapp",
      "autoRelaunch": true
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "npm test",
      "watchPaths": ["src/**/*", "test/**/*"]
    }
  ]
}
```
</details>

<details>
<summary>Full configuration options (with defaults shown for reference)</summary>

```json
{
  "version": "1.0",
  "projectType": "swift|node|rust|python|cmake|mixed",
  "targets": [/* target configs */],
  "watchman": {
    "useDefaultExclusions": true,        // default: true
    "excludeDirs": ["custom", "exclusions"],
    "maxFileEvents": 10000,              // default: 10000
    "rules": [{"pattern": "**/test_output/**", "action": "ignore"}]
  },
  "performance": {
    "profile": "balanced",               // default: "balanced"
    "autoOptimize": true                 // default: true
  },
  "buildScheduling": {
    "parallelization": 2,                // default: 2
    "prioritization": {
      "enabled": true,                   // default: true
      "focusDetectionWindow": 300000     // default: 300000 (5 min)
    }
  },
  "notifications": {
    "enabled": true,                     // default: true
    "successSound": "Glass",
    "failureSound": "Basso"
  },
  "logging": {
    "file": ".poltergeist.log",         // default: ".poltergeist.log"
    "level": "info"                     // default: "info"
  }
}
```
</details>

## Advanced Features

### CMake Support

Poltergeist includes comprehensive CMake support with automatic target detection:

#### Auto-Initialization
```bash
# Automatically detect and configure all CMake targets
poltergeist init --cmake

# Options
poltergeist init --cmake --generator Ninja    # Specify generator
poltergeist init --cmake --preset debug        # Use CMake preset
poltergeist init --cmake --dry-run            # Preview configuration
```

#### CMake Features
- **Automatic Target Detection**: Parses `CMakeLists.txt` to find all targets
- **Smart Reconfiguration**: Automatically runs `cmake` when CMakeLists.txt changes  
- **Multi-Generator Support**: Works with Ninja, Make, Visual Studio, Xcode
- **Build Type Management**: Supports Debug, Release, RelWithDebInfo, MinSizeRel
- **Preset Integration**: Works with `CMakePresets.json`
- **Parallel Builds**: Uses `cmake --build --parallel` by default

#### Example CMake Configuration
```json
{
  "version": "1.0",
  "projectType": "cmake",
  "targets": [
    {
      "name": "spine-c-debug",
      "type": "cmake-executable",
      "targetName": "spine-c",
      "buildType": "Debug",
      "watchPaths": [
        "**/CMakeLists.txt",
        "src/**/*.{c,cpp,h}",
        "cmake/**/*.cmake"
      ]
    }
  ]
}
```

### Watch Pattern Optimization

Poltergeist automatically optimizes watch patterns using brace expansion and redundancy elimination:

- **Brace Expansion**: Consolidates similar paths (e.g., `foo/{bar,baz}/**/*.c`)
- **Redundancy Elimination**: Removes subdirectory patterns when parent is already watched
- **Size Reduction**: Typically reduces configuration size by 40-70%

```json
// Before optimization:
"watchPaths": [
  "spine-c-unit-tests/memory/**/*.{c,cpp,h}",
  "spine-c-unit-tests/minicppunit/**/*.{c,cpp,h}",
  "spine-c-unit-tests/tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}"
]

// After optimization (automatic):
"watchPaths": [
  "spine-c-unit-tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}"
]
```

This happens automatically during `poltergeist init`.

### Performance Profiles

Optimize Poltergeist for your project size and needs:

```json
{
  "performance": {"profile": "conservative|balanced|aggressive", "autoOptimize": true}
}
```

- **conservative**: Maximum file coverage, small projects
- **balanced**: Default, good performance/coverage balance  
- **aggressive**: Maximum performance, large projects

### Intelligent Build Prioritization

Automatically builds what you're working on first using focus detection and priority scoring:

```json
{
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {"enabled": true, "focusDetectionWindow": 300000}
  }
}
```

**How it works**: Analyzes file change patterns → prioritizes active targets → builds in smart order → faster feedback loops

### Smart Exclusions

Poltergeist includes 70+ optimized exclusion patterns:
- **Version Control**: `.git`, `.svn`, `.hg`
- **Build Artifacts**: `node_modules`, `DerivedData`, `target/`, `build/`
- **IDE Files**: `.vscode`, `.idea`, `*.xcworkspace`
- **OS Files**: `.DS_Store`, `Thumbs.db`
- **Project-specific**: Language and framework-specific patterns

### Advanced Configuration Options

<details>
<summary>Custom exclusions, environment variables, timeouts</summary>

```json
{
  "watchman": {
    "rules": [{"pattern": "**/test_results/**", "action": "ignore"}]
  },
  "targets": [
    {
      "name": "backend",
      "buildCommand": "npm run build:prod",
      "environment": {"NODE_ENV": "production", "API_URL": "https://api.com"},
      "maxRetries": 3,
      "settlingDelay": 2000
    }
  ]
}
```
</details>

### Configuration Reloading

Poltergeist loads configuration once at startup. **Configuration changes require a restart** to take effect:

```bash
# Restart to apply configuration changes
poltergeist restart

# Or restart specific target only
poltergeist restart --target my-app
```

**When to Restart:**
- After changing build commands or watch paths
- After modifying notification settings
- After adjusting performance profiles
- After updating exclusion rules



## Examples

<details>
<summary>Project configuration examples</summary>

### Swift Package Manager Project
```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "cli-tool",
      "type": "executable",
      "buildCommand": "swift build -c release",
      "outputPath": "./.build/release/MyTool",
      "watchPaths": ["{Sources,Tests}/**/*.swift", "Package.swift"]
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "swift test",
      "watchPaths": ["{Sources,Tests}/**/*.swift", "Package.swift"]
    }
  ]
}
```

### Mixed Language Project (Swift + Node.js)
```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "swift-backend",
      "type": "executable",
      "buildCommand": "./scripts/build-swift.sh",
      "outputPath": "./bin/backend",
      "watchPaths": ["{Backend,Shared}/**/*.swift"]
    },
    {
      "name": "react-frontend", 
      "type": "executable",
      "buildCommand": "npm run build",
      "outputPath": "./frontend/dist",
      "watchPaths": ["frontend/src/**/*.{ts,tsx,js,jsx,css,scss}"]
    },
    {
      "name": "mac-app",
      "type": "app-bundle",
      "bundleId": "com.example.myapp",
      "buildCommand": "xcodebuild -scheme MyApp",
      "autoRelaunch": true,
      "watchPaths": ["{MacApp,Shared}/**/*.{swift,xib,storyboard}"]
    }
  ]
}
```

### Docker Development Environment
```json
{
  "version": "1.0",
  "projectType": "node",
  "targets": [
    {
      "name": "api-dev",
      "type": "docker",
      "imageName": "myapp/api",
      "buildCommand": "docker build -f docker/Dockerfile.dev -t myapp/api:dev .",
      "watchPaths": ["src/**/*.{js,ts}", "{package,package-lock}.json", "docker/Dockerfile.dev"]
    }
  ]
}
```

### C/C++ Project with CMake
```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "libspine-debug",
      "type": "library",
      "buildCommand": "./build.sh",
      "outputPath": "./build/libspine-c.a",
      "watchPaths": [
        "{src,include}/**/*.{c,cpp,h}",
        "{CMakeLists.txt,CMakePresets.json}"
      ],
      "environment": { "CMAKE_BUILD_TYPE": "Debug" }
    }
  ],
  "watchman": {
    "excludeDirs": ["build", "target"]
  }
}
```

### macOS/iOS Universal App
```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "universal-app",
      "type": "app-bundle",
      "buildCommand": "xcodebuild -scheme UniversalApp -sdk macosx",
      "watchPaths": [
        "**/*.{swift,m,h}",
        "**/*.{xcodeproj,xcconfig,entitlements,plist}",
        "**/*.{xib,storyboard,xcassets}"
      ],
      "settlingDelay": 1500  // Only if needed, default is 1000ms
    }
  ]
}
```

### Real-World Example: Peekaboo
```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "peekaboo-cli",
      "type": "executable",
      "buildCommand": "./scripts/build-swift-debug.sh",
      "outputPath": "./peekaboo",
      "watchPaths": [
        "{Core,Apps/CLI}/**/*.swift"
      ],
      "icon": "./assets/icon_512x512@2x.png"
    },
    {
      "name": "peekaboo-mac",
      "type": "app-bundle",
      "platform": "macos",
      "buildCommand": "./scripts/build-mac-debug.sh",
      "bundleId": "boo.peekaboo.mac.debug",
      "autoRelaunch": true,
      "watchPaths": [
        "Apps/Mac/**/*.{swift,storyboard,xib}",
        "Core/**/*.swift"
      ]
    }
  ]
}
```

</details>

## Architecture

### Multi-Project Process Model

Poltergeist uses a **distributed architecture** where each project runs its own independent background process:

#### Per-Project Processes
```bash
# Terminal 1 - Project A
cd ~/projects/my-app
poltergeist haunt  # Starts separate background process for my-app

# Terminal 2 - Project B  
cd ~/projects/spine-c
poltergeist haunt  # Starts separate background process for spine-c

# Terminal 3 - From anywhere
cd ~
poltergeist status  # Shows ALL projects: my-app + spine-c
```

#### How It Works
1. **Isolation**: Each `poltergeist haunt` spawns an independent Node.js process
2. **State Discovery**: Commands scan `/tmp/poltergeist/` to find all active projects
3. **Global Commands**: `status`, `clean`, etc. work across all projects simultaneously
4. **Per-Project Commands**: `stop --target`, `restart --target` affect specific targets

#### Benefits
- **Reliability**: One project crashing doesn't affect others
- **Flexibility**: Start/stop projects independently  
- **Performance**: No single bottleneck across all projects
- **Cross-Terminal**: Start in one terminal, manage from another
- **Scalability**: Handle 10+ projects without performance degradation

### Dual-Platform Communication

The **Node.js CLI** and **macOS app** communicate through shared state files, not direct IPC:

```
Node.js CLI Process          macOS Native App
       ↓                            ↓
   Builds targets              Monitors state
   Updates state               Shows notifications
       ↓                            ↓
       ┌─────────────────────────────┐
       │   /tmp/poltergeist/         │
       │   ├── project-a.state       │
       │   ├── project-b.state       │
       │   └── project-c.state       │
       └─────────────────────────────┘
                Shared State Files
```

This design enables:
- **Platform Independence**: CLI works without macOS app
- **Real-time Sync**: macOS app instantly reflects CLI changes
- **Crash Resilience**: Either component can restart independently

## State Management & Logging

### Atomic State System

Poltergeist uses a **lock-free state management system** with atomic file operations to ensure data consistency across multiple processes and tools.

#### State File Locations
- **Unix/Linux/macOS**: `/tmp/poltergeist/`
- **Windows**: `%TEMP%\poltergeist\`
- **File Pattern**: `{projectName}-{hash}-{target}.state`

```bash
/tmp/poltergeist/
├── my-app-abc123-frontend.state      # Frontend target
├── my-app-abc123-backend.state       # Backend target  
├── spine-c-def456-debug.state        # CMake debug build
├── another-project-ghi789-main.state # Main executable
└── ...
```

#### Atomic Write Operations

All state updates use **atomic writes** to prevent corruption:

1. **Write to temp file**: `{target}.state.tmp.{pid}`
2. **Atomic rename**: `mv temp → {target}.state` 
3. **Lock-free**: No file locking, no deadlocks

This ensures state files are **never partially written** and can be safely read by multiple processes simultaneously.

#### State File Structure

```json
{
  "version": "1.0",
  "projectPath": "/Users/dev/my-project",
  "projectName": "my-project", 
  "target": "frontend",
  "process": {
    "pid": 12345,
    "hostname": "MacBook-Pro.local",
    "isActive": true,
    "startTime": "2025-08-05T20:15:30.000Z",
    "lastHeartbeat": "2025-08-05T20:16:00.000Z"
  },
  "lastBuild": {
    "status": "success|failure|building|idle",
    "timestamp": "2025-08-05T20:15:47.500Z",
    "duration": 2500,
    "gitHash": "abc123f",
    "builder": "CMake-Executable/Ninja",
    "errorSummary": "Optional error message"
  },
  "appInfo": {
    "bundleId": "com.example.myapp",
    "outputPath": "./build/Debug/MyApp.app",
    "iconPath": "./assets/icon.png"
  }
}
```

#### Heartbeat Monitoring

Each Poltergeist process updates its heartbeat every **30 seconds**:

- **Active Process**: `lastHeartbeat` within 30 seconds → `isActive: true`
- **Stale Process**: `lastHeartbeat` older than 30 seconds → `isActive: false`
- **Automatic Cleanup**: `poltergeist clean` removes stale state files

### Logging System

#### Structured JSON Logging

Poltergeist uses **structured JSON logs** with Winston for machine-readable output:

```json
{"timestamp":"2025-08-05T20:15:30.123Z","level":"info","message":"Build completed successfully","target":"frontend","duration":2500,"gitHash":"abc123f"}
{"timestamp":"2025-08-05T20:15:35.456Z","level":"error","message":"Build failed","target":"backend","exitCode":1,"errorSummary":"Compilation error in main.cpp:42"}
```

#### Log File Management

- **Location**: `.poltergeist.log` in project root (configurable via `logging.file`)
- **Rotation**: Automatic rotation prevents unlimited growth
- **Multi-Target**: Single log file contains all targets with filtering support
- **Real-time**: `poltergeist logs --follow` for live monitoring
- **Build Observation**: Log files provide detailed build progress and error details beyond state files

#### Log Commands

```bash
# View recent logs
poltergeist logs                    # Last 50 lines, all targets
poltergeist logs --target frontend  # Filter by target
poltergeist logs --lines 100        # Show more lines

# Follow logs in real-time
poltergeist logs --follow           # All targets
poltergeist logs --follow --target backend

# JSON output for processing
poltergeist logs --json | jq '.level == "error"'
```

#### Build Status Observation

Poltergeist provides **multiple layers** for observing build status and progress:

##### 1. State Files (Current Status)
```bash
# Quick status check - current build state only
jq -r '.lastBuild.status' /tmp/poltergeist/my-project-*-frontend.state
# Output: "success" | "failure" | "building" | "idle"

# Get build duration and error summary
jq -r '.lastBuild | "\(.status) - \(.duration)ms - \(.errorSummary // "no errors")"' /tmp/poltergeist/*.state
```

##### 2. Log Files (Detailed History)
```bash
# Watch build progress in real-time
poltergeist logs --follow --target frontend

# Find recent build failures with details
poltergeist logs --json | jq 'select(.level == "error" and .target == "frontend")'

# Monitor build times over time
poltergeist logs --json | jq 'select(.message | contains("Build completed")) | {target, duration, timestamp}'
```

##### 3. Combined Monitoring Workflow
```bash
# Terminal 1: Watch logs for detailed progress
poltergeist logs --follow

# Terminal 2: Check current status across all projects  
watch -n 2 'poltergeist status'

# Terminal 3: Monitor specific build metrics
watch -n 5 'find /tmp/poltergeist -name "*.state" -exec jq -r "\"\\(.target): \\(.lastBuild.status) (\\(.lastBuild.duration // 0)ms)\"" {} \;'
```

**Key Differences:**
- **State Files**: Current snapshot, fast access, minimal details
- **Log Files**: Complete history, detailed errors, build output, timestamps
- **Combined**: State files for quick checks, logs for debugging and analysis

### Cross-Tool Integration

The state files are designed for **external tool integration**:

#### Shell Scripts
```bash
# Check if project is building
if jq -r '.lastBuild.status' /tmp/poltergeist/my-project-*.state | grep -q "building"; then
  echo "Build in progress..."
fi
```

#### IDEs and Editors
```javascript
// VS Code extension example
const stateFiles = glob('/tmp/poltergeist/*.state');
const buildStatuses = stateFiles.map(file => JSON.parse(fs.readFileSync(file)));
```

#### CI/CD Integration
```yaml
# GitHub Actions example
- name: Wait for Poltergeist build
  run: |
    while [[ $(jq -r '.lastBuild.status' /tmp/poltergeist/*-main.state) == "building" ]]; do
      sleep 5
    done
```

This architecture enables rich integrations while maintaining simplicity and reliability across all supported platforms.

## Development

### Prerequisites
- **Node.js 20+** for CLI development
- **Xcode 15+** for macOS app development
- **Watchman** for file watching

### CLI Development
```bash
# Build from source
git clone https://github.com/steipete/poltergeist.git
cd poltergeist && npm install && npm run build

# Development commands
npm test                    # Run tests
npm run dev                 # Auto-rebuild mode
npm run lint                # Code quality checks
npm run typecheck           # Type validation
```

### macOS App Development
```bash
# Navigate to macOS app
cd apps/mac

# Build and run
xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist build
open Poltergeist.xcodeproj

# Code quality
./scripts/lint.sh           # SwiftLint checks
./scripts/format.sh         # swift-format fixes
```

### CI/CD Pipeline

Our comprehensive CI/CD pipeline ensures code quality across both platforms:

- **Multi-platform testing**: Node.js 20/22 on Ubuntu, macOS, and Windows
- **Swift 6 validation**: Strict concurrency checking and modern Swift practices
- **Code quality**: SwiftLint, swift-format, Biome, and TypeScript checks
- **Automated releases**: Dual-platform releases with both CLI (.tgz) and macOS app (.dmg/.zip)
- **Test coverage**: Comprehensive coverage reporting with Codecov

<details>
<summary>Project structure and contributing guidelines</summary>

### Project Structure
```
poltergeist/
├── src/
│   ├── builders/           # Target-specific builders
│   ├── cli.ts             # Command line interface  
│   ├── poltergeist.ts     # Core application logic
│   ├── priority-engine.ts # Intelligent priority scoring
│   ├── build-queue.ts     # Smart build queue management
│   ├── state.ts           # State management system
│   └── watchman.ts        # Watchman file watching
├── test/                  # Vitest test files
└── dist/                  # Compiled JavaScript output
```

### Contributing
Contributions welcome! Requirements:
1. Tests pass: `npm test`
2. Code formatted: `npm run format` 
3. Linting passes: `npm run lint`
4. Types check: `npm run typecheck`

### Development Philosophy
- **No backwards compatibility**: Clean breaks over legacy support
- **Type safety first**: Compile-time safety over runtime flexibility
- **Performance over features**: Optimize for large projects
- **Simple over complex**: Clean APIs over extensive configuration

</details>

## Changelog

For detailed information about releases, bug fixes, and improvements, see [CHANGELOG.md](CHANGELOG.md).

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Author

Created and maintained by [Peter Steinberger](https://github.com/steipete)

## Acknowledgments

Built with these excellent open source projects:

### Core Dependencies
- **[Watchman](https://facebook.github.io/watchman/)** - Facebook's efficient file watching service
- **[Commander.js](https://github.com/tj/commander.js)** - Complete CLI framework
- **[Zod](https://zod.dev/)** - TypeScript-first schema validation with static type inference
- **[Winston](https://github.com/winstonjs/winston)** - Universal logging library with support for multiple transports

### Build & Development
- **[TypeScript](https://www.typescriptlang.org/)** - JavaScript with syntax for types
- **[Vitest](https://vitest.dev/)** - Blazing fast unit test framework
- **[Biome](https://biomejs.dev/)** - Fast formatter and linter for JavaScript, TypeScript, and more
- **[TSX](https://github.com/privatenumber/tsx)** - TypeScript execute and REPL for Node.js
- **[TypeDoc](https://typedoc.org/)** - Documentation generator for TypeScript projects

### User Experience
- **[Chalk](https://github.com/chalk/chalk)** - Terminal string styling done right
- **[Ora](https://github.com/sindresorhus/ora)** - Elegant terminal spinners
- **[Node Notifier](https://github.com/mikaelbr/node-notifier)** - Cross-platform native notifications

### Utilities
- **[Picomatch](https://github.com/micromatch/picomatch)** - Blazing fast and accurate glob matcher
- **[Write File Atomic](https://github.com/npm/write-file-atomic)** - Write files atomically and reliably
- **[fb-watchman](https://github.com/facebook/watchman)** - JavaScript client for Facebook's Watchman service

### Special Thanks
- All contributors and users who have helped shape Poltergeist
- The open source community for creating these amazing tools

---

<div align="center">
  <strong>Keep your builds fresh with Poltergeist</strong>
</div>