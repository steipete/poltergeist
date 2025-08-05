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

Poltergeist is an AI-friendly universal file-watcher that auto-detects any project and rebuilds them as soon as a file has been changed.

Works on macOS, Linux, and Windows, using Node and Watchman 

## Dual Platform Support

Poltergeist offers both a **Node.js CLI** for universal development and a **native macOS app** for enhanced monitoring:

### CLI Tool (Cross-Platform)
- **Universal**: Works on macOS, Linux, and Windows  
- **Node.js 20+** required
- **Watchman support**: All platforms officially supported
- Install: `npm install -g @steipete/poltergeist`

### macOS App (Native)
- **Native performance** with Swift 6
- **Real-time monitoring** in menu bar
- **System notifications** with build status
- **Download**: Get the latest `.dmg` from [releases](https://github.com/steipete/poltergeist/releases)</div>

## Features

- **Universal Target System**: Support for executables, app bundles, libraries, frameworks, tests, Docker containers, and custom builds
- **Smart Execution Wrapper**: `polter` command ensures you never run stale or failed builds
- **Efficient File Watching**: Powered by Facebook's Watchman with smart exclusions and performance optimization
- **Intelligent Build Prioritization**: Automatic priority scoring based on focus patterns and user behavior
- **Smart Build Queue Management**: Configurable parallelization with intelligent deduplication and scheduling
- **Focus Pattern Detection**: Automatically detects which targets you're actively working on
- **Intelligent Project Detection**: Automatically detects Swift, Node.js, Rust, Python, CMake, and mixed projects
- **Smart Configuration**: Project-specific exclusions with performance profiles (conservative, balanced, aggressive)
- **Native Notifications**: macOS notifications with customizable sounds for build status
- **Concurrent Build Protection**: Intelligent locking prevents overlapping builds
- **Advanced State Management**: Process tracking, build history, and heartbeat monitoring
- **Cross-Platform**: Works on macOS, Linux, and Windows
- **Automatic Configuration Reloading**: Changes to `poltergeist.config.json` are detected and applied without manual restart

## Quick Start

### Installation

Install globally via npm:

```bash
npm install -g @steipete/poltergeist
```

Or run directly using npx:

```bash
npx @steipete/poltergeist haunt
```

### Basic Usage

1. For CMake projects, use auto-initialization:

```bash
poltergeist init --cmake
```

Or manually create a `poltergeist.config.json` in your project root:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "my-cli",
      "type": "executable",
      "buildCommand": "./scripts/build.sh",
      "outputPath": "./bin/mycli",
      "watchPaths": ["src/**/*.{swift,h}"]
    }
  ]
}
```

2. Start watching:

```bash
# Start as daemon (default - non-blocking)
poltergeist haunt

# Start in foreground (traditional blocking mode)
poltergeist haunt --foreground
```

## Requirements

### CLI Tool
- **Node.js 20.0.0** or higher
- **[Watchman](https://facebook.github.io/watchman/)** (must be installed separately)
- **Cross-platform**: macOS, Linux, Windows
  - **macOS**: `brew install watchman`
  - **Linux**: [Installation guide](https://facebook.github.io/watchman/docs/install#linux)
  - **Windows**: [Chocolatey package](https://facebook.github.io/watchman/docs/install#windows) or manual install

### macOS App
- **macOS 14.0+** (Sonoma or later)
- **Apple Silicon & Intel** both supported
- **Automatic CLI integration** when installed

## Configuration

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
      "name": "my-app",
      "type": "cmake-executable",
      "targetName": "my-app",        // CMake target name
      "buildType": "Debug",          // Debug, Release, etc.
      "watchPaths": [
        "**/CMakeLists.txt",
        "src/**/*.{cpp,h}",
        "cmake/**/*.cmake"
      ]
    }
  ]
}
```

### Watch Pattern Optimization

Poltergeist automatically optimizes watch patterns using brace expansion and redundancy elimination:

#### Automatic Optimization
- **Brace Expansion**: Consolidates similar paths (e.g., `foo/{bar,baz}/**/*.c`)
- **Redundancy Elimination**: Removes subdirectory patterns when parent is already watched
- **Size Reduction**: Typically reduces configuration size by 40-70%

#### Example
```json
// Before optimization (generated patterns):
"watchPaths": [
  "spine-c-unit-tests/memory/**/*.{c,cpp,h}",
  "spine-c-unit-tests/minicppunit/**/*.{c,cpp,h}",
  "spine-c-unit-tests/teamcity/**/*.{c,cpp,h}",
  "spine-c-unit-tests/tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/include/spine/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}",
  "spine-c/src/spine/**/*.{c,cpp,h}"
]

// After optimization (automatic):
"watchPaths": [
  "spine-c-unit-tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}"
]
```

This optimization happens automatically during `poltergeist init` and reduces both config file size and Watchman's processing overhead.

### Smart Project Detection

Poltergeist automatically detects your project type based on configuration files:

| Project Type | Detection Files | Optimized For |
|-------------|----------------|---------------|
| `swift` | `Package.swift` | SPM, Xcode, `.build`, `DerivedData` |
| `node` | `package.json` | `node_modules`, build outputs, logs |
| `rust` | `Cargo.toml` | `target/`, Cargo artifacts |
| `python` | `pyproject.toml`, `requirements.txt` | `__pycache__`, virtual envs |
| `cmake` | `CMakeLists.txt` | `build/`, `CMakeFiles/`, `CMakeCache.txt` |
| `mixed` | Multiple indicators | Combined exclusions from all types |

### Performance Profiles

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

Includes 70+ optimized patterns: version control (`.git`), build artifacts (`node_modules`, `DerivedData`, `target/`), IDE files (`.vscode`, `.idea`), OS files (`.DS_Store`), and project-specific exclusions.

### Advanced Configuration

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

## Command Line Interface

### Daemon Mode (New Default)

Starting with version 1.4.0, Poltergeist runs as a daemon by default:

- **Non-blocking**: Returns control to your terminal immediately
- **Background operation**: Continues watching and building in the background
- **Better for automation**: Easier integration with scripts and CI/CD
- **Logs**: Output saved to log files, viewable with `poltergeist logs`

```bash
# Start daemon (default)
poltergeist haunt

# Check status
poltergeist status

# View logs
poltergeist logs          # Show recent logs
poltergeist logs -f       # Follow logs (like tail -f)

# Stop daemon
poltergeist stop

# Run in foreground (traditional mode)
poltergeist haunt --foreground
```

### Commands

| Command | Description |
|---------|-------------|
| `poltergeist haunt\|start [options]` | Start watching and auto-building (daemon by default) |
| `poltergeist stop\|rest [options]` | Stop the Poltergeist daemon |
| `poltergeist restart [options]` | Restart Poltergeist daemon |
| `poltergeist status [options]` | Check Poltergeist status |
| `poltergeist logs [options]` | Show daemon logs (`-f` to follow) |
| `poltergeist list [options]` | List all configured targets |
| `poltergeist clean [options]` | Clean up stale state files |

### Options

#### `haunt` / `start`
```bash
poltergeist haunt [options]
  -t, --target <name>   Target to build (omit to build all enabled targets)
  -c, --config <path>   Path to config file
  -v, --verbose         Enable verbose logging
  -f, --foreground      Run in foreground (blocking mode)
```

#### `stop` / `rest`
```bash
poltergeist stop [options]
  -t, --target <name>   Stop specific target only
  -c, --config <path>   Path to config file
```

#### `restart`
```bash
poltergeist restart [options]
  -c, --config <path>   Path to config file
  -f, --foreground      Restart in foreground mode
  -v, --verbose         Enable verbose logging
```

#### `status`
```bash
poltergeist status [options]
  -t, --target <name>   Check specific target status
  -c, --config <path>   Path to config file
  --json               Output status as JSON
```

#### `logs`
```bash
poltergeist logs [options]
  -t, --target <name>   Show logs for specific target
  -n, --lines <number>  Number of lines to show (default: 50)
  -f, --follow          Follow log output
  -c, --config <path>   Path to config file
  --json                Output logs in JSON format
```

#### `list`
```bash
poltergeist list [options]
  -c, --config <path>   Path to config file
```

#### `clean`
```bash
poltergeist clean [options]
  -a, --all            Remove all state files, not just stale ones
  -d, --days <number>  Remove state files older than N days (default: 7)
  --dry-run            Show what would be removed without actually removing
```

### Status Output

```bash
$ poltergeist status

👻 Poltergeist Status
══════════════════════════════════════════════════
Target: poltergeist-cli
  Status: running
  Process: Running (PID: 1652 on Peters-MBP.localdomain)
  Heartbeat: ✓ Active (8s ago)
  Last Build: 8/5/2025, 4:57:20 AM
  Build Status: ✅ Success
  Build Time: 765ms
  Git Hash: d762366
  Builder: Executable
  Output: /Users/steipete/Projects/poltergeist/dist/cli.js
```

### Helpful Error Messages

Poltergeist provides intelligent error messages with suggestions when you specify an invalid target:

```bash
$ poltergeist logs peekaboo-mac

❌ Target 'peekaboo-mac' not found

Available targets:
  • poltergeist-cli (executable)
  • poltergeist-mac (app-bundle) [disabled]
  • test-runner (test)

Did you mean 'poltergeist-mac'?

Usage: npx poltergeist logs <target> [options]
Example: npx poltergeist logs poltergeist-cli --tail 50
```

**Features:**
- **Target listing**: Shows all configured targets with their types and status
- **Fuzzy matching**: Suggests similar target names for typos
- **Usage examples**: Provides correct command syntax with available targets
- **Works across commands**: The same helpful errors appear for `logs`, `wait`, `status`, and `haunt` commands

### Configuration Changes

Poltergeist loads configuration once at startup. **Configuration changes require a restart** to take effect.

```bash
# Restart to apply configuration changes
poltergeist restart

# Or restart specific target only
poltergeist restart --target my-app

# Clear Watchman cache on restart (if needed)
poltergeist restart --no-cache
```

#### Common Configuration Workflow

1. **Edit** `poltergeist.config.json`
2. **Restart** with `poltergeist restart`
3. **Verify** with `poltergeist status`

#### When to Restart

Restart after changing:
- Target configurations (build commands, watch paths)
- Notification settings
- Watchman exclusions or performance settings
- Build scheduling options

> **Design Note**: Configuration is loaded once for reliability and performance. This prevents configuration corruption during builds and avoids file watching overhead for rarely-changed config files.

## Smart Execution with polter

Never run stale or failed builds again! The `polter` command is a smart wrapper that ensures you always execute fresh binaries.

### The Problem & Solution

```bash
# 😱 Without polter - might run stale builds:
./dist/my-tool deploy --production   # Disaster if using old code!

# ✅ With polter - always fresh builds:
polter my-tool deploy --production    # Waits for build, guarantees fresh code
```

### How It Works

1. **State Discovery**: Finds your project's poltergeist configuration
2. **Build Status Check**: Reads current build state from temp directory (`/tmp/poltergeist/` on Unix, `%TEMP%\poltergeist` on Windows)
3. **Smart Waiting**: Waits for in-progress builds with live progress
4. **Fail Fast**: Immediately exits on build failures with clear messages
5. **Fresh Execution**: Only runs executables when builds are confirmed fresh
6. **Graceful Fallback**: When Poltergeist isn't running, executes potentially stale binaries with warnings

### Fallback Behavior

When Poltergeist is not running or configuration is missing, `polter` gracefully falls back to stale execution:

```bash
⚠️  POLTERGEIST NOT RUNNING - EXECUTING POTENTIALLY STALE BINARY
   The binary may be outdated. For fresh builds, start Poltergeist:
   npm run poltergeist:haunt

✅ Running binary: my-app (potentially stale)
```

**Fallback Logic**:
1. **No config found**: Attempts to find binary in common locations (`./`, `./build/`, `./dist/`)
2. **Target not configured**: Searches for binary even if not in Poltergeist config
3. **Binary discovery**: Tries multiple paths and handles suffix variations (`-cli`, `-app`)
4. **Smart execution**: Detects file type (`.js`, `.py`, `.sh`) and uses appropriate interpreter
5. **Clear warnings**: Always warns when running without build verification

This ensures `polter` never completely blocks your workflow, while clearly indicating when builds might be stale.

### Installation & Basic Usage

```bash
# Global installation (recommended)
npm install -g @steipete/poltergeist

# Now polter is available globally
polter <target-name> [target-arguments...]

# Examples:
polter my-app --timeout 60000    # Wait up to 60 seconds
polter my-app --force            # Run even if build failed
polter my-app --no-wait          # Fail immediately if building
polter my-app --verbose          # Show detailed progress

# Create convenient aliases
alias myapp="polter my-app"
alias dev="polter dev-server --watch"
```

### Status Messages

```bash
🔨 Waiting for build to complete... (8s elapsed)
❌ Build failed! Cannot execute stale binary.
✅ Build completed successfully! Executing fresh binary...
```

<details>
<summary>Integration examples and advanced usage</summary>

#### Shell Integration
```bash
# .bashrc/.zshrc aliases (after global install)
alias myapp="polter my-app-target"
alias dev="polter dev-server --watch"
alias pb="polter peekaboo"  # For Peekaboo users

# package.json scripts
{
  "scripts": {
    "start": "polter web-server --port 3000",
    "deploy:prod": "polter deploy-tool --env production"
  }
}

# No wrapper scripts needed - use polter directly!
```

#### Multi-Service Configuration
```json
{
  "targets": [
    {"name": "api", "buildCommand": "go build -o ./bin/api ./cmd/api"},
    {"name": "worker", "buildCommand": "go build -o ./bin/worker ./cmd/worker"},
    {"name": "frontend", "buildCommand": "npm run build"}
  ]
}
```

```bash
polter api --port 8080        # Fresh API server
polter worker --queue jobs    # Fresh worker process
polter frontend --serve       # Fresh frontend build
```

#### Troubleshooting
```bash
# Timeout issues
export POLTER_DEFAULT_TIMEOUT=60000
polter my-app

# Configuration check
polter --verbose my-app 2>&1 | grep "Config"
poltergeist status --target my-app
```

</details>

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

- **[Watchman](https://facebook.github.io/watchman/)** for efficient file watching
- **[Zod](https://zod.dev/)** for runtime type validation
- **[Winston](https://github.com/winstonjs/winston)** for structured logging
- **[Commander.js](https://github.com/tj/commander.js)** for CLI framework

---

<div align="center">
  <strong>Keep your builds fresh with Poltergeist</strong>
</div>