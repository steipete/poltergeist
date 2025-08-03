<div align="center">
  <img src="assets/poltergeist-logo.png" alt="Poltergeist Logo" width="200">
  
  # Poltergeist

  [![CI](https://github.com/steipete/poltergeist/actions/workflows/ci.yml/badge.svg)](https://github.com/steipete/poltergeist/actions/workflows/ci.yml)
  [![Node.js Version](https://img.shields.io/node/v/@steipete/poltergeist)](https://nodejs.org)
  [![npm version](https://img.shields.io/npm/v/@steipete/poltergeist)](https://www.npmjs.com/package/@steipete/poltergeist)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

  **The ghost that keeps your builds fresh** 👻  
  A universal file watcher with auto-rebuild for any language or build system
</div>

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

- **Node.js 20.0.0** or higher
- **[Watchman](https://facebook.github.io/watchman/)** (must be installed separately)
- **macOS** for notification features (optional)

## Configuration

### Configuration Schema

Poltergeist uses a clean, modern configuration schema:

```json
{
  "version": "1.0",
  "projectType": "swift|node|rust|python|mixed",
  "targets": [
    {
      "name": "target-name",
      "type": "executable|app-bundle|library|framework|test|docker|custom",
      "enabled": true,
      "buildCommand": "build command",
      "watchPaths": ["glob/patterns/**/*.ext"],
      "settlingDelay": 1000,
      "debounceInterval": 5000,
      "maxRetries": 3,
      "environment": {
        "ENV_VAR": "value"
      },
      "icon": "./path/to/icon.png"
    }
  ],
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": ["custom", "exclusions"],
    "projectType": "swift",
    "maxFileEvents": 10000,
    "recrawlThreshold": 3,
    "settlingDelay": 1000,
    "rules": [
      {
        "pattern": "**/test_output/**",
        "action": "ignore",
        "reason": "Test artifacts",
        "enabled": true
      }
    ]
  },
  "performance": {
    "profile": "balanced",
    "autoOptimize": true,
    "metrics": {
      "enabled": true,
      "reportInterval": 300
    }
  },
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 300000,
      "priorityDecayTime": 1800000,
      "buildTimeoutMultiplier": 2.0
    }
  },
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso"
  },
  "logging": {
    "file": ".poltergeist.log",
    "level": "debug"
  }
}
```

### Target Types

#### Executable Target
For CLI tools, binaries, and general applications:

```json
{
  "name": "my-cli",
  "type": "executable",
  "buildCommand": "cargo build --release",
  "outputPath": "./target/release/myapp",
  "watchPaths": ["src/**/*.rs", "Cargo.toml"]
}
```

#### App Bundle Target
For macOS, iOS, and Apple platform applications:

```json
{
  "name": "mac-app",
  "type": "app-bundle",
  "platform": "macos",
  "bundleId": "com.example.myapp",
  "buildCommand": "xcodebuild -scheme MyApp",
  "autoRelaunch": true,
  "watchPaths": ["Sources/**/*.swift"]
}
```

#### Library Target
For static and dynamic libraries:

```json
{
  "name": "mylib",
  "type": "library",
  "libraryType": "static",
  "buildCommand": "make lib",
  "outputPath": "./lib/libmylib.a",
  "watchPaths": ["lib/**/*.c", "include/**/*.h"]
}
```

#### Framework Target
For macOS/iOS frameworks:

```json
{
  "name": "MyFramework",
  "type": "framework",
  "platform": "macos",
  "buildCommand": "xcodebuild -target MyFramework",
  "outputPath": "./build/MyFramework.framework",
  "watchPaths": ["Framework/**/*.swift"]
}
```

#### Test Target
For test suites:

```json
{
  "name": "tests",
  "type": "test",
  "testCommand": "swift test",
  "coverageFile": "./coverage.xml",
  "watchPaths": ["Tests/**/*.swift", "Sources/**/*.swift"]
}
```

#### Docker Target
For containerized applications:

```json
{
  "name": "api-server",
  "type": "docker",
  "imageName": "myapp/api",
  "dockerfile": "./Dockerfile.dev",
  "context": ".",
  "tags": ["latest", "dev"],
  "buildCommand": "docker build -t myapp/api .",
  "watchPaths": ["src/**/*", "Dockerfile*"]
}
```

#### Custom Target
For custom build processes:

```json
{
  "name": "custom-build",
  "type": "custom",
  "buildCommand": "./custom-build.sh",
  "config": {
    "customOption": "value",
    "flags": ["--optimize", "--verbose"]
  },
  "watchPaths": ["custom/**/*"]
}
```

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

Choose the right balance between file coverage and performance:

```json
{
  "performance": {
    "profile": "conservative|balanced|aggressive",
    "autoOptimize": true,
    "metrics": {
      "enabled": true,
      "reportInterval": 300
    }
  }
}
```

| Profile | Description | Max Exclusions | Use Case |
|---------|-------------|----------------|----------|
| `conservative` | Maximum file coverage | 20 | Small projects, debugging |
| `balanced` | Good performance/coverage balance | 50 | Most projects (default) |
| `aggressive` | Maximum performance | 100 | Large projects, CI/CD |

### Intelligent Build Prioritization

Poltergeist includes an intelligent build prioritization system that automatically optimizes build order based on your development patterns:

```json
{
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 300000,
      "priorityDecayTime": 1800000,
      "buildTimeoutMultiplier": 2.0
    }
  }
}
```

#### Key Features

- **Automatic Focus Detection**: Analyzes file change patterns to identify which targets you're actively working on
- **Smart Priority Scoring**: Uses heuristics based on direct file changes, build success rates, and timing patterns
- **Configurable Parallelization**: Control concurrent builds (1-10, default: 2)
- **Dynamic Re-prioritization**: Adjusts build order in real-time as you work
- **Build Queue Management**: Intelligent deduplication and pending rebuild tracking

#### Configuration Options

| Setting | Description | Default | Range |
|---------|-------------|---------|-------|
| `parallelization` | Number of concurrent builds | `2` | 1-10 |
| `enabled` | Enable intelligent prioritization | `true` | boolean |
| `focusDetectionWindow` | Time window for focus detection (ms) | `300000` | 60000-3600000 |
| `priorityDecayTime` | Priority score decay period (ms) | `1800000` | 300000-7200000 |
| `buildTimeoutMultiplier` | Timeout scaling factor | `2.0` | 1.0-10.0 |

#### How It Works

1. **File Change Classification**: Categorizes changes as direct, shared, or generated
2. **Focus Pattern Detection**: Identifies recently active targets within the focus window
3. **Priority Scoring**: Combines direct changes (100 points), focus multipliers (1x-2x), and success rates
4. **Queue Management**: Orders builds by priority, respects parallelization limits
5. **Real-time Adjustment**: Updates priorities as new changes occur

#### Usage Examples

**Serial Mode** (testing, debugging):
```json
{
  "buildScheduling": {
    "parallelization": 1,
    "prioritization": { "enabled": true }
  }
}
```

**High Throughput** (large projects):
```json
{
  "buildScheduling": {
    "parallelization": 4,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 180000,
      "priorityDecayTime": 900000
    }
  }
}
```

**Traditional Mode** (disable prioritization):
```json
{
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": { "enabled": false }
  }
}
```

#### Benefits

- **Reduced Wait Times**: Builds what you're working on first
- **Better Resource Utilization**: Optimizes parallel build scheduling
- **Automatic Optimization**: No manual configuration required
- **Development Efficiency**: Faster feedback loops for active work

### Smart Exclusions

Poltergeist includes 70+ optimized exclusion patterns:

**Universal Exclusions** (all projects):
- Version control: `.git`, `.svn`, `.hg`
- OS files: `.DS_Store`, `Thumbs.db`
- IDE files: `.vscode`, `.idea`, `.cursor`
- Temporary files: `tmp`, `*.tmp`, `*.temp`

**Swift Project Exclusions**:
- SPM: `.build`, `Package.resolved`
- Xcode: `DerivedData`, `*.xcuserdata`
- Build artifacts: `*.dSYM`, `*.framework`

**Node.js Project Exclusions**:
- Dependencies: `node_modules`
- Build outputs: `dist`, `.next`, `.nuxt`
- Logs: `*.log`, `npm-debug.log*`

### Advanced Configuration

#### Custom Exclusion Rules

```json
{
  "watchman": {
    "rules": [
      {
        "pattern": "**/test_results/**",
        "action": "ignore",
        "reason": "Test output directory",
        "enabled": true
      },
      {
        "pattern": "**/*.xcuserstate",
        "action": "ignore",
        "reason": "Xcode user state files",
        "enabled": true
      }
    ]
  }
}
```

#### Environment Variables

```json
{
  "targets": [
    {
      "name": "backend",
      "buildCommand": "npm run build:prod",
      "environment": {
        "NODE_ENV": "production",
        "API_URL": "https://api.example.com",
        "DEBUG": "app:*"
      }
    }
  ]
}
```

#### Build Timeouts and Retries

```json
{
  "targets": [
    {
      "name": "heavy-build",
      "buildCommand": "./long-build.sh",
      "maxRetries": 5,
      "backoffMultiplier": 2.0,
      "settlingDelay": 2000,
      "debounceInterval": 10000
    }
  ]
}
```

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

## Smart Execution with pgrun

Never run stale or failed builds again! The `pgrun` command is a smart wrapper that ensures you always execute fresh binaries. It's like having a build-aware shell that prevents you from running outdated code.

### The Problem pgrun Solves

Without pgrun, you might accidentally:
```bash
# 😱 These could run stale/broken builds:
./dist/my-tool deploy --production   # Disaster if using old code!
./bin/myapp --critical-operation     # Fails silently with stale binary
yarn start                           # Might serve old frontend build
```

### The pgrun Solution

```bash
# ✅ These always use fresh, validated builds:
pgrun my-tool deploy --production    # Waits for build, guarantees fresh code
pgrun myapp --critical-operation     # Fails fast if build broken
pgrun frontend-dev                   # Only serves latest build
```

### How It Works

`pgrun` acts as an intelligent build-aware executor:

1. **🔍 State Discovery**: Finds your project's poltergeist configuration
2. **📊 Build Status Check**: Reads current build state from `/tmp/poltergeist/`
3. **⏳ Smart Waiting**: Waits for in-progress builds with live progress
4. **❌ Fail Fast**: Immediately exits on build failures with clear messages
5. **🚀 Fresh Execution**: Only runs executables when builds are confirmed fresh
6. **📦 Transparent Proxy**: Passes all arguments through seamlessly

### Real-World Examples

#### Development Workflow
```bash
# Traditional workflow (error-prone):
# 1. Edit code
# 2. Wait for build... (did it finish? succeed?)
# 3. ./my-tool test  # Might run old version!

# pgrun workflow (bulletproof):
# 1. Edit code  
# 2. pgrun my-tool test  # Automatically waits for fresh build
```

#### CI/CD Integration
```bash
# In your deployment script:
pgrun my-api deploy --production

# If build failed, deployment stops immediately
# If build is fresh, deployment uses latest code
# If build is in progress, waits automatically
```

#### Development Servers
```bash
# Start dev server with fresh build
pgrun frontend-dev --port 3000

# API server with latest backend
pgrun api-server --env development
```

### Command Usage

```bash
pgrun <target-name> [target-arguments...]

# Target name matches your poltergeist.config.json targets
# All arguments after target name are passed through
```

### Command Options

```bash
Options:
  -t, --timeout <ms>    Build wait timeout in milliseconds (default: 30000)
  -f, --force          Run even if build failed (bypass safety check)
  -n, --no-wait        Don't wait for builds, fail immediately if building  
  -v, --verbose        Show detailed status and progress information
  -h, --help           Display help message

Examples:
  pgrun my-cli --help              # Show help for my-cli tool
  pgrun api --force deploy         # Force deploy even if build failed
  pgrun frontend --timeout 60000   # Wait up to 60 seconds for build
  pgrun worker --no-wait           # Fail immediately if build in progress
```

### Status Messages

pgrun provides clear feedback about what's happening:

```bash
# Build in progress:
🔨 Waiting for build to complete... (8s elapsed)
⏳ Still building... (20s elapsed, max 10s remaining)

# Build failures:
❌ Build failed! Cannot execute stale binary.
💡 Run 'poltergeist logs' to see build errors
💡 Fix the build errors and try again

# Success:
✅ Build completed successfully! Executing fresh binary...
[your program output here]
```

### Integration Patterns

#### Shell Aliases
Create convenient aliases for your tools:
```bash
# In your .bashrc/.zshrc
alias myapp="pgrun my-app-target"
alias dev="pgrun dev-server --watch"
alias test="pgrun test-runner"
alias deploy="pgrun deployment-tool"

# Now you can just type:
myapp --version    # Always fresh!
dev               # Waits for build automatically
test --verbose    # Runs latest test binary
```

#### npm/yarn Scripts
Integrate with package.json scripts:
```json
{
  "scripts": {
    "start": "pgrun web-server --port 3000",
    "dev": "pgrun dev-server --hot-reload",
    "test": "pgrun test-suite --coverage",
    "build": "poltergeist haunt",
    "deploy:staging": "pgrun deploy-tool --env staging",
    "deploy:prod": "pgrun deploy-tool --env production"
  }
}
```

#### IDE Integration
Configure your IDE to use pgrun for run configurations:
```bash
# VS Code tasks.json
{
  "version": "2.0.0", 
  "tasks": [
    {
      "label": "Run with pgrun",
      "type": "shell",
      "command": "pgrun",
      "args": ["my-app", "${input:args}"],
      "group": "build"
    }
  ]
}
```

#### Docker Development
Use with containerized development:
```bash
# Dockerfile.dev
FROM node:20
# ... setup ...
CMD ["pgrun", "api-server", "--docker-mode"]

# docker-compose.yml
services:
  api:
    build: .
    command: pgrun api-server --env development
    volumes:
      - ./:/app
```

### Configuration Examples

#### Multi-Service Project
```json
{
  "targets": [
    {
      "name": "api",
      "type": "executable", 
      "buildCommand": "go build -o ./bin/api ./cmd/api",
      "outputPath": "./bin/api"
    },
    {
      "name": "worker",
      "type": "executable",
      "buildCommand": "go build -o ./bin/worker ./cmd/worker", 
      "outputPath": "./bin/worker"
    },
    {
      "name": "frontend",
      "type": "executable",
      "buildCommand": "npm run build",
      "outputPath": "./dist"
    }
  ]
}
```

Usage:
```bash
pgrun api --port 8080        # Runs fresh API server
pgrun worker --queue jobs    # Runs fresh worker process  
pgrun frontend --serve       # Serves fresh frontend build
```

#### Testing Workflow
```json
{
  "targets": [
    {
      "name": "test-runner",
      "type": "executable",
      "buildCommand": "cargo build --bin test-runner",
      "outputPath": "./target/debug/test-runner"
    },
    {
      "name": "integration-tests", 
      "type": "test",
      "testCommand": "cargo test --test integration",
      "buildCommand": "cargo build --tests"
    }
  ]
}
```

Usage:
```bash
pgrun test-runner unit               # Run unit tests with fresh binary
pgrun test-runner integration       # Run integration tests  
pgrun test-runner --coverage        # Generate coverage with latest code
```

### Troubleshooting

#### Build Timeout
```bash
# Increase timeout for slow builds
pgrun my-app --timeout 120000   # 2 minutes

# Or set in environment
export PGRUN_DEFAULT_TIMEOUT=60000
pgrun my-app
```

#### Force Running Failed Builds
```bash
# Sometimes you need to run despite build failures
pgrun my-app --force --debug-mode

# Useful for:
# - Debugging build issues
# - Running partially working builds
# - Emergency deployments (use with caution!)
```

#### Configuration Issues
```bash
# Check if poltergeist config is found
pgrun --verbose my-app 2>&1 | grep "Config"

# Verify target exists
poltergeist list

# Check build status
poltergeist status --target my-app
```

### Advanced Use Cases

#### Multi-Platform Builds
```bash
# Build different versions for different platforms
pgrun my-app-linux --platform linux
pgrun my-app-windows --platform windows
pgrun my-app-macos --platform darwin
```

#### Environment-Specific Builds
```bash
# Development vs production builds
pgrun my-app-dev --env development
pgrun my-app-prod --env production --optimized
```

#### Parallel Development
```bash
# Multiple developers can use pgrun safely
# Each waits for their own builds, no conflicts
pgrun feature-branch-build --feature my-feature
pgrun main-branch-build --branch main
```

#### Why pgrun is Essential

1. **🛡️ Safety First**: Prevents running stale code in production
2. **⚡ Developer Efficiency**: No more manual build checking
3. **🔄 Seamless Workflow**: Transparent integration with existing scripts
4. **📊 Build Awareness**: Always know your build status
5. **🚀 Team Coordination**: Consistent behavior across team members
6. **🐛 Debug Friendly**: Clear error messages and status reporting

> **Pro Tip**: Make pgrun your default way to run any built executable. Your future self will thank you when you avoid running a stale build in production!

## Examples

### Swift Package Manager Project

```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "cli-tool",
      "type": "executable",
      "enabled": true,
      "buildCommand": "swift build -c release",
      "outputPath": "./.build/release/MyTool",
      "watchPaths": [
        "Sources/**/*.swift",
        "Package.swift"
      ],
      "settlingDelay": 1000
    },
    {
      "name": "tests",
      "type": "test",
      "enabled": true,
      "testCommand": "swift test",
      "watchPaths": [
        "Sources/**/*.swift",
        "Tests/**/*.swift"
      ]
    }
  ],
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": [],
    "projectType": "swift",
    "maxFileEvents": 10000,
    "recrawlThreshold": 3,
    "settlingDelay": 1000
  },
  "performance": {
    "profile": "balanced",
    "autoOptimize": true
  },
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso"
  }
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
      "enabled": true,
      "buildCommand": "./scripts/build-swift.sh",
      "outputPath": "./bin/backend",
      "watchPaths": [
        "Backend/**/*.swift",
        "Shared/**/*.swift"
      ],
      "environment": {
        "SWIFT_ENV": "development"
      }
    },
    {
      "name": "react-frontend",
      "type": "executable",
      "enabled": true,
      "buildCommand": "npm run build",
      "outputPath": "./frontend/dist",
      "watchPaths": [
        "frontend/src/**/*.{ts,tsx,js,jsx}",
        "frontend/public/**/*"
      ],
      "environment": {
        "NODE_ENV": "development"
      }
    },
    {
      "name": "mac-app",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "bundleId": "com.example.myapp",
      "buildCommand": "xcodebuild -scheme MyApp",
      "autoRelaunch": true,
      "watchPaths": [
        "MacApp/**/*.swift",
        "MacApp/**/*.storyboard",
        "Shared/**/*.swift"
      ]
    }
  ],
  "watchman": {
    "useDefaultExclusions": true,
    "excludeDirs": [
      "logs",
      "coverage",
      "dist",
      "tmp_*"
    ],
    "projectType": "mixed",
    "maxFileEvents": 15000,
    "recrawlThreshold": 3,
    "settlingDelay": 1000,
    "rules": [
      {
        "pattern": "**/node_modules/**",
        "action": "ignore",
        "reason": "NPM dependencies",
        "enabled": true
      },
      {
        "pattern": "**/.build/**",
        "action": "ignore",
        "reason": "Swift build artifacts",
        "enabled": true
      }
    ]
  },
  "performance": {
    "profile": "balanced",
    "autoOptimize": true,
    "metrics": {
      "enabled": true,
      "reportInterval": 300
    }
  }
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
      "enabled": true,
      "imageName": "myapp/api",
      "dockerfile": "./docker/Dockerfile.dev",
      "context": ".",
      "tags": ["dev", "latest"],
      "buildCommand": "docker build -f docker/Dockerfile.dev -t myapp/api:dev .",
      "watchPaths": [
        "src/**/*.js",
        "package.json",
        "docker/Dockerfile.dev"
      ],
      "environment": {
        "DOCKER_BUILDKIT": "1"
      }
    },
    {
      "name": "frontend-dev",
      "type": "docker",
      "enabled": true,
      "imageName": "myapp/frontend",
      "buildCommand": "docker build -f frontend/Dockerfile -t myapp/frontend:dev ./frontend",
      "watchPaths": [
        "frontend/src/**/*",
        "frontend/package.json",
        "frontend/Dockerfile"
      ]
    }
  ],
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Submarine"
  }
}
```

## State Management

### Unified State System

Poltergeist uses a lock-free state management system with atomic operations:

- **Single state file per target**: `/tmp/poltergeist/target-{name}.state.json`
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

### Building from Source

```bash
# Clone the repository
git clone https://github.com/steipete/poltergeist.git
cd poltergeist

# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm test

# Development mode with auto-rebuild
npm run dev
```

### Project Structure

```
poltergeist/
├── src/
│   ├── builders/           # Target-specific builders
│   │   ├── executable-builder.ts
│   │   ├── app-bundle-builder.ts
│   │   └── base-builder.ts
│   ├── cli.ts             # Command line interface
│   ├── config.ts          # Configuration loading & validation
│   ├── poltergeist.ts     # Core application logic
│   ├── priority-engine.ts # Intelligent priority scoring
│   ├── build-queue.ts     # Smart build queue management
│   ├── state.ts           # State management system
│   ├── types.ts           # TypeScript type definitions
│   ├── watchman.ts        # Watchman file watching
│   ├── watchman-config.ts # Smart Watchman configuration
│   ├── notifier.ts        # Native notifications
│   └── logger.ts          # Structured logging
├── test/                  # Vitest test files
├── dist/                  # Compiled JavaScript output
└── poltergeist.config.json
```

### Code Quality

```bash
# Linting with Biome
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:check

# Type checking
npm run typecheck

# Run all quality checks
npm run build && npm test && npm run lint
```

## Testing

Comprehensive test suite with Vitest:

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

## Contributing

Contributions welcome! Please ensure:

1. **Tests pass**: `npm test`
2. **Code is formatted**: `npm run format`
3. **Linting passes**: `npm run lint`
4. **Types check**: `npm run typecheck`
5. **Clean modern code**: Focus on maintainable, type-safe implementations

### Development Philosophy

- **No backwards compatibility**: Clean breaks over legacy support
- **Type safety first**: Prefer compile-time safety over runtime flexibility
- **Performance over features**: Optimize for large projects
- **Simple over complex**: Clean APIs over extensive configuration

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