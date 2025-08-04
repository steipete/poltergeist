<div align="center">
  <img src="assets/poltergeist-logo.png" alt="Poltergeist Logo" width="200">
  
  # Poltergeist

  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js 20+"></a>
  <a href="https://github.com/steipete/poltergeist"><img src="https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-blue?style=for-the-badge" alt="Platforms"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green?style=for-the-badge" alt="MIT License"></a>
  <a href="https://github.com/steipete/poltergeist/actions/workflows/ci.yml"><img src="https://github.com/steipete/poltergeist/actions/workflows/ci.yml/badge.svg" alt="CI Status"></a>

  **The ghost that keeps your builds fresh** 👻  
  A universal file watcher with auto-rebuild for any language or build system
</div>

## 🎯 Dual Platform Support

Poltergeist offers both a **Node.js CLI** for universal development and a **native macOS app** for enhanced monitoring:

### CLI Tool (Cross-Platform) 🌍
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
- **Smart Execution Wrapper**: `pgrun` command ensures you never run stale or failed builds
- **Efficient File Watching**: Powered by Facebook's Watchman with smart exclusions and performance optimization
- **Intelligent Build Prioritization**: Automatic priority scoring based on focus patterns and user behavior
- **Smart Build Queue Management**: Configurable parallelization with intelligent deduplication and scheduling
- **Focus Pattern Detection**: Automatically detects which targets you're actively working on
- **Intelligent Project Detection**: Automatically detects Swift, Node.js, Rust, Python, and mixed projects
- **Smart Configuration**: Project-specific exclusions with performance profiles (conservative, balanced, aggressive)
- **Native Notifications**: macOS notifications with customizable sounds for build status
- **Concurrent Build Protection**: Intelligent locking prevents overlapping builds
- **Advanced State Management**: Process tracking, build history, and heartbeat monitoring
- **Cross-Platform**: Works on macOS, Linux, and Windows

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

1. Create a `poltergeist.config.json` in your project root:

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "my-cli",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./scripts/build.sh",
      "outputPath": "./bin/mycli",
      "watchPaths": ["src/**/*.swift"]
    }
  ],
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": [],
    "maxFileEvents": 10000,
    "recrawlThreshold": 3,
    "settlingDelay": 1000
  }
}
```

2. Start watching:

```bash
poltergeist haunt
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
- **macOS 12.0+** (Monterey or later)
- **Apple Silicon & Intel** both supported
- **Automatic CLI integration** when installed

## Configuration

### Configuration Schema

Essential configuration structure:

```json
{
  "version": "1.0",
  "projectType": "swift|node|rust|python|mixed",
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

<details>
<summary>Full configuration options</summary>

```json
{
  "version": "1.0",
  "projectType": "swift|node|rust|python|mixed",
  "targets": [/* target configs */],
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": ["custom", "exclusions"],
    "maxFileEvents": 10000,
    "rules": [{"pattern": "**/test_output/**", "action": "ignore"}]
  },
  "performance": {"profile": "balanced", "autoOptimize": true},
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {"enabled": true, "focusDetectionWindow": 300000}
  },
  "notifications": {"enabled": true, "successSound": "Glass"},
  "logging": {"file": ".poltergeist.log", "level": "info"}
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

### Smart Project Detection

Poltergeist automatically detects your project type based on configuration files:

| Project Type | Detection Files | Optimized For |
|-------------|----------------|---------------|
| `swift` | `Package.swift` | SPM, Xcode, `.build`, `DerivedData` |
| `node` | `package.json` | `node_modules`, build outputs, logs |
| `rust` | `Cargo.toml` | `target/`, Cargo artifacts |
| `python` | `pyproject.toml`, `requirements.txt` | `__pycache__`, virtual envs |
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

### Commands

| Command | Description |
|---------|-------------|
| `poltergeist haunt [options]` | Start watching and building |
| `poltergeist stop [options]` | Stop Poltergeist processes |
| `poltergeist status [options]` | Display build status |
| `poltergeist list [options]` | List configured targets |
| `poltergeist clean [options]` | Clean stale state files |
| `poltergeist logs [options]` | Display build logs |

### Options

#### `haunt` / `start`
```bash
poltergeist haunt [options]
  -t, --target <name>   Build only specific target
  -c, --config <path>   Custom config file path
  -v, --verbose         Enable verbose logging
```

#### `status`
```bash
poltergeist status [options]
  -t, --target <name>   Show specific target status
  -v, --verbose         Detailed status information
```

#### `list`
```bash
poltergeist list [options]
  -c, --config <path>   Custom config file path
```

### Status Output

```bash
$ poltergeist status

👻 Poltergeist Status
══════════════════════════════════════════════════
Target: my-cli
  Status: running
  Process: 12345 (host: MacBook-Pro.local)
  Last Build: 8/2/2025, 8:15:30 PM
  Build Status: ✅ Success
  Build Time: 2.3s
  Git Hash: abc123f
  Builder: Executable
  Output: ./bin/mycli
```

### Configuration Changes and Reloading

**Important**: Poltergeist loads configuration once at startup and does **not** hot-reload configuration changes. To apply configuration updates, you must restart Poltergeist.

#### How Configuration Loading Works

1. **Load Once at Startup**: Configuration is read from `poltergeist.config.json` when Poltergeist starts
2. **Stored in Memory**: All settings (targets, notifications, build commands) are cached in memory for performance
3. **No File Watching**: Poltergeist only watches your source files, not the configuration file itself
4. **Restart Required**: Changes to `poltergeist.config.json` require a restart to take effect

#### When to Restart

Restart Poltergeist after changing any of these settings:
- Target configurations (build commands, watch paths, output paths)
- Notification settings (sounds, enabled/disabled status)
- Watchman configuration (exclusions, performance settings)
- Build scheduling and parallelization options

```bash
# Stop current instance
poltergeist stop

# Start with new configuration
poltergeist haunt
```

#### Why No Hot Reloading?

This design choice ensures:
- **Reliability**: Prevents configuration corruption during live builds
- **Performance**: Avoids file watching overhead for rarely-changed config
- **Simplicity**: Clear separation between source code changes and configuration changes
- **Consistency**: Predictable behavior across different development workflows

#### Quick Configuration Test

To verify configuration changes are loaded:

```bash
# After restarting, check status to confirm new settings
poltergeist status

# Enable debug logging to see configuration details
POLTERGEIST_LOG_LEVEL=debug poltergeist haunt
```

## Smart Execution with pgrun

Never run stale or failed builds again! The `pgrun` command is a smart wrapper that ensures you always execute fresh binaries.

### The Problem & Solution

```bash
# 😱 Without pgrun - might run stale builds:
./dist/my-tool deploy --production   # Disaster if using old code!

# ✅ With pgrun - always fresh builds:
pgrun my-tool deploy --production    # Waits for build, guarantees fresh code
```

### How It Works

1. **State Discovery**: Finds your project's poltergeist configuration
2. **Build Status Check**: Reads current build state from temp directory (`/tmp/poltergeist/` on Unix, `%TEMP%\poltergeist` on Windows)
3. **Smart Waiting**: Waits for in-progress builds with live progress
4. **Fail Fast**: Immediately exits on build failures with clear messages
5. **Fresh Execution**: Only runs executables when builds are confirmed fresh
6. **Graceful Fallback**: When Poltergeist isn't running, executes potentially stale binaries with warnings

### Fallback Behavior

When Poltergeist is not running or configuration is missing, `pgrun` gracefully falls back to stale execution:

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

This ensures `pgrun` never completely blocks your workflow, while clearly indicating when builds might be stale.

### Installation & Basic Usage

```bash
# Global installation (recommended)
npm install -g @steipete/poltergeist

# Now pgrun is available globally
pgrun <target-name> [target-arguments...]

# Examples:
pgrun my-app --timeout 60000    # Wait up to 60 seconds
pgrun my-app --force            # Run even if build failed
pgrun my-app --no-wait          # Fail immediately if building
pgrun my-app --verbose          # Show detailed progress

# Create convenient aliases
alias myapp="pgrun my-app"
alias dev="pgrun dev-server --watch"
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
alias myapp="pgrun my-app-target"
alias dev="pgrun dev-server --watch"
alias pb="pgrun peekaboo"  # For Peekaboo users

# package.json scripts
{
  "scripts": {
    "start": "pgrun web-server --port 3000",
    "deploy:prod": "pgrun deploy-tool --env production"
  }
}

# No wrapper scripts needed - use pgrun directly!
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
pgrun api --port 8080        # Fresh API server
pgrun worker --queue jobs    # Fresh worker process
pgrun frontend --serve       # Fresh frontend build
```

#### Troubleshooting
```bash
# Timeout issues
export PGRUN_DEFAULT_TIMEOUT=60000
pgrun my-app

# Configuration check
pgrun --verbose my-app 2>&1 | grep "Config"
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
      "watchPaths": ["Sources/**/*.swift", "Package.swift"]
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "swift test",
      "watchPaths": ["Sources/**/*.swift", "Tests/**/*.swift"]
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
      "watchPaths": ["Backend/**/*.swift", "Shared/**/*.swift"]
    },
    {
      "name": "react-frontend", 
      "type": "executable",
      "buildCommand": "npm run build",
      "outputPath": "./frontend/dist",
      "watchPaths": ["frontend/src/**/*.{ts,tsx,js,jsx}"]
    },
    {
      "name": "mac-app",
      "type": "app-bundle",
      "bundleId": "com.example.myapp",
      "buildCommand": "xcodebuild -scheme MyApp",
      "autoRelaunch": true,
      "watchPaths": ["MacApp/**/*.swift", "Shared/**/*.swift"]
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
      "watchPaths": ["src/**/*.js", "package.json", "docker/Dockerfile.dev"]
    }
  ]
}
```

</details>

## State Management

### Unified State System

Poltergeist uses a lock-free state management system with atomic operations:

- **Single state file per target**: Cross-platform temp directory (`/tmp/poltergeist/` on Unix, `%TEMP%\poltergeist` on Windows)
- **Atomic writes**: Temp file + rename for consistency
- **Heartbeat monitoring**: Process liveness detection
- **Build history**: Track success/failure patterns
- **Cross-tool compatibility**: State readable by external tools

### State File Structure

```json
{
  "target": "my-app",
  "status": "running",
  "process": {
    "pid": 12345,
    "hostname": "MacBook-Pro.local",
    "startTime": "2025-08-02T20:15:30.000Z",
    "heartbeat": "2025-08-02T20:16:00.000Z"
  },
  "build": {
    "status": "success",
    "startTime": "2025-08-02T20:15:45.000Z",
    "endTime": "2025-08-02T20:15:47.500Z",
    "duration": 2500,
    "gitHash": "abc123f",
    "outputPath": "./bin/myapp"
  },
  "app": {
    "bundleId": "com.example.myapp",
    "path": "/Applications/MyApp.app"
  }
}
```

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