# Poltergeist

**The Ghost That Keeps Your Builds Fresh**

[![npm version](https://badge.fury.io/js/@steipete%2Fpoltergeist.svg)](https://www.npmjs.com/package/@steipete/poltergeist)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Poltergeist is a universal file watcher that automatically rebuilds your projects whenever you save a file. Whether you're working on CLI tools, desktop apps, web projects, or any codebase that needs compilation, Poltergeist haunts your files and ensures your builds are always up-to-date.

```bash
# Quick start with npm
npm install -g @steipete/poltergeist
cd your-project
poltergeist init
poltergeist haunt
```

## Features

- **Language Agnostic**: Works with any build system - Swift, Rust, Go, TypeScript, C++, or anything else
- **Automatic Rebuilding**: Detects file changes and triggers builds instantly
- **Auto-Relaunch**: Optionally quit and restart apps after successful builds (macOS)
- **Build Status Tracking**: JSON-based status files for integration with other tools
- **Native Notifications**: macOS notifications with sound for build success/failure
- **Smart Retry Logic**: Exponential backoff for handling transient build failures
- **Flexible Configuration**: Multiple targets with custom watch paths and build commands
- **Structured Logging**: Winston-based logging with file and console output
- **Efficient File Watching**: Uses Facebook's Watchman for native, performant file monitoring

## Installation

### Global Installation (Recommended)

```bash
# Install globally from npm
npm install -g @steipete/poltergeist

# Or using npx (no installation needed)
npx @steipete/poltergeist init
```

### Local Development

```bash
# Clone the repository
git clone https://github.com/steipete/Peekaboo.git
cd Peekaboo/tools/poltergeist

# Install dependencies
npm install

# Build TypeScript
npm run build

# Link for global usage
npm link
```

### Prerequisites

- **Node.js**: Version 18 or higher
- **Watchman**: Facebook's file watching service
  ```bash
  # Install on macOS
  brew install watchman
  
  # Or download from https://facebook.github.io/watchman/
  ```

## Quick Start

1. **Navigate to your project directory**:
   ```bash
   cd my-project
   ```

2. **Initialize a configuration file**:
   ```bash
   poltergeist init
   ```

3. **Edit `poltergeist.config.json`** to match your project structure

4. **Start watching**:
   ```bash
   poltergeist haunt
   ```

**Important**: Poltergeist always reads `poltergeist.config.json` from the current working directory. This allows each project to have its own configuration without specifying paths.

## Configuration

The `poltergeist.config.json` file controls all aspects of Poltergeist's behavior. Here's a complete example showing different types of projects:

```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "cargo build --release",
    "outputPath": "./target/release/my-cli",
    "statusFile": "/tmp/my-cli-build-status.json",
    "lockFile": "/tmp/my-cli-build.lock",
    "watchPaths": [
      "src/**/*.rs",
      "Cargo.toml",
      "Cargo.lock"
    ],
    "settlingDelay": 1000,
    "maxRetries": 3,
    "backoffMultiplier": 2
  },
  "macApp": {
    "enabled": false,
    "buildCommand": "xcodebuild -workspace MyApp.xcworkspace -scheme MyApp -configuration Debug build",
    "bundleId": "com.example.myapp",
    "statusFile": "/tmp/my-app-build-status.json",
    "lockFile": "/tmp/my-app-build.lock",
    "autoRelaunch": true,
    "watchPaths": [
      "MyApp/**/*.swift",
      "MyApp/**/*.storyboard",
      "MyApp/**/*.xib"
    ],
    "settlingDelay": 1000,
    "maxRetries": 3,
    "backoffMultiplier": 2
  },
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso"
  },
  "logging": {
    "file": ".poltergeist.log",
    "level": "info"
  }
}
```

### Example Configurations for Different Languages

<details>
<summary>TypeScript/Node.js Project</summary>

```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "npm run build",
    "outputPath": "./dist/index.js",
    "statusFile": "/tmp/ts-build-status.json",
    "lockFile": "/tmp/ts-build.lock",
    "watchPaths": [
      "src/**/*.ts",
      "src/**/*.tsx",
      "package.json",
      "tsconfig.json"
    ],
    "settlingDelay": 500
  }
}
```
</details>

<details>
<summary>Go Project</summary>

```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "go build -o ./bin/myapp ./cmd/myapp",
    "outputPath": "./bin/myapp",
    "statusFile": "/tmp/go-build-status.json",
    "lockFile": "/tmp/go-build.lock",
    "watchPaths": [
      "**/*.go",
      "go.mod",
      "go.sum"
    ],
    "settlingDelay": 1000
  }
}
```
</details>

<details>
<summary>C++ Project with Make</summary>

```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "make -j8",
    "outputPath": "./build/myapp",
    "statusFile": "/tmp/cpp-build-status.json",
    "lockFile": "/tmp/cpp-build.lock",
    "watchPaths": [
      "src/**/*.cpp",
      "src/**/*.h",
      "include/**/*.h",
      "Makefile",
      "CMakeLists.txt"
    ],
    "settlingDelay": 2000
  }
}
```
</details>

### Configuration Options

#### Target Configuration (cli/macApp)

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | boolean | Whether this target is active |
| `buildCommand` | string | Shell command to execute for building |
| `outputPath` | string | Path to the built binary (CLI only) |
| `bundleId` | string | Bundle identifier for auto-relaunch (Mac app only) |
| `statusFile` | string | Path to JSON file tracking build status |
| `lockFile` | string | Path to lock file preventing concurrent builds |
| `autoRelaunch` | boolean | Quit and restart app after build (Mac app only) |
| `watchPaths` | string[] | Glob patterns for files to watch |
| `settlingDelay` | number | Milliseconds to wait after changes stop before building |
| `maxRetries` | number | Maximum build retry attempts |
| `backoffMultiplier` | number | Multiplier for exponential backoff between retries |

#### Notifications

| Option | Type | Description |
|--------|------|-------------|
| `enabled` | boolean | Enable/disable macOS notifications |
| `successSound` | string | macOS sound name for successful builds |
| `failureSound` | string | macOS sound name for failed builds |

Set `POLTERGEIST_NOTIFICATIONS=false` to temporarily disable notifications.

#### Logging

| Option | Type | Description |
|--------|------|-------------|
| `file` | string | Path to log file (relative to project root) |
| `level` | string | Log level: error, warn, info, debug |

## Commands

### `haunt` (or `start`)
Start watching and auto-building your Swift project.

```bash
poltergeist haunt [options]

Options:
  --cli          Watch only CLI targets
  --mac          Watch only Mac app targets
  --all          Watch all targets (default)
  -c, --config   Path to config file (default: ./poltergeist.config.json)
  -v, --verbose  Enable verbose logging
```

### `rest` (or `stop`)
Stop the Poltergeist watcher.

```bash
poltergeist rest
```

Note: Currently displays instructions to use Ctrl+C in the running process.

### `status`
Show the current build status for all targets.

```bash
poltergeist status

Example output:
=== Poltergeist Status ===

CLI Target:
  Status: success
  Last build: 2025-01-29T10:30:45.123Z
  Build time: 12.3s
  Watch paths: Core/**/*.swift, Apps/CLI/**/*.swift, Package.swift

Mac App Target:
  Status: building
  Last build: 2025-01-29T10:31:02.456Z
  Watch paths: Apps/Mac/**/*.swift, Core/**/*.swift
  Auto-relaunch: Yes
```

### `init`
Create a new configuration file with sensible defaults.

```bash
poltergeist init [options]

Options:
  -f, --force  Overwrite existing config file
```

## Build Status Format

Poltergeist writes build status to JSON files that can be consumed by other tools:

```json
{
  "status": "success",
  "timestamp": "2025-01-29T10:30:45.123Z",
  "gitHash": "abc123",
  "errorSummary": "",
  "builder": "poltergeist",
  "buildTime": 12345
}
```

Status values:
- `"building"`: Build in progress
- `"success"`: Build completed successfully
- `"failed"`: Build failed with errors

## Architecture

### Component Overview

1. **CLI Interface** (`cli.ts`)
   - Commander.js-based CLI with subcommands
   - Configuration loading and validation
   - Process lifecycle management

2. **Main Orchestrator** (`poltergeist.ts`)
   - Coordinates file watching and building
   - Manages build queues per target
   - Handles concurrent build prevention

3. **Watchman Client** (`watchman.ts`)
   - Wraps Facebook's Watchman file watcher
   - Manages subscriptions with glob patterns
   - Emits file change events with settling delay

4. **Build System** (`builder.ts`)
   - Abstract `Builder` class with target-specific implementations
   - `CLIBuilder`: Builds Swift Package Manager projects
   - `MacAppBuilder`: Builds Xcode projects with auto-relaunch
   - Handles retry logic with exponential backoff

5. **Notification System** (`notifier.ts`)
   - macOS native notifications via node-notifier
   - Configurable sounds and timeouts
   - Environment variable override support

6. **Type System** (`types.ts`)
   - Zod schemas for runtime validation
   - TypeScript types for compile-time safety
   - Comprehensive configuration interfaces

### Build Flow

1. **File Change Detection**
   - Watchman monitors specified paths
   - Changes are queued with settling delay
   - Multiple rapid changes are batched

2. **Build Execution**
   - Status file updated to "building"
   - Build command executed with output streaming
   - Git hash captured for traceability

3. **Post-Build Actions**
   - Status file updated with results
   - Notifications sent (if enabled)
   - Mac apps relaunched (if configured)
   - Retry scheduled on failure

### Key Design Decisions

- **TypeScript over Bash**: Better error handling, type safety, and maintainability
- **Watchman Integration**: Native file watching without shell command parsing
- **Queue-Based Building**: Prevents concurrent builds and handles rapid changes
- **Status File Communication**: Enables integration with wrapper scripts
- **Modular Architecture**: Clear separation of concerns for extensibility

## Integration with Other Tools

### Wrapper Scripts

Poltergeist is designed to work with wrapper scripts that check build freshness:

```bash
# Example: peekaboo-wait.sh
if [[ "$binary_time" -lt "$newest_source_time" ]]; then
    echo "🔄 Binary is stale, waiting for Poltergeist to rebuild..."
    # Check status file and wait for "success" status
fi
```

### Build Status Monitoring

Other tools can monitor the status files to:
- Display build progress in UI
- Block operations during builds
- Show error summaries on failure

## Troubleshooting

### Watchman Issues

If you see "Watchman capability check failed":
```bash
# Ensure Watchman is installed
brew install watchman

# Check Watchman status
watchman version
```

### Build Failures

1. Check the log file (`.poltergeist.log` by default)
2. Run the build command manually to see full output
3. Verify file paths in configuration match your project

### Performance

- Increase `settlingDelay` if builds trigger too frequently
- Adjust `watchPaths` to exclude unnecessary directories
- Use specific glob patterns rather than broad wildcards

## Environment Variables

- `POLTERGEIST_NOTIFICATIONS=false`: Disable notifications
- `FORCE_COLOR=1`: Automatically set for colorized build output
- Standard Node.js variables (`NODE_ENV`, etc.)

## Contributing

Poltergeist is part of the Peekaboo project. When making changes:

1. Update TypeScript types in `types.ts`
2. Run `npm run build` to compile
3. Test all commands thoroughly
4. Update this README if behavior changes

## Usage as an NPM Package

Poltergeist is distributed as an npm package and can be installed globally or per-project. It always reads its configuration from the current directory's `poltergeist.config.json` file.

### Global Installation (Recommended)

Install once, use in any project:

```bash
# Install globally
npm install -g @steipete/poltergeist

# Now available as a command in any directory
cd ~/Projects/MyApp
poltergeist init
poltergeist haunt
```

### Per-Project Installation

Add Poltergeist to a specific project:

```bash
# In your project directory
npm init -y  # If you don't have a package.json
npm install --save-dev @steipete/poltergeist

# Run with npx
npx poltergeist init
npx poltergeist haunt
```

Or add to your `package.json` scripts:

```json
{
  "scripts": {
    "watch": "poltergeist haunt",
    "watch:cli": "poltergeist haunt --cli",
    "watch:mac": "poltergeist haunt --mac",
    "build:status": "poltergeist status"
  },
  "devDependencies": {
    "@steipete/poltergeist": "^1.0.0"
  }
}
```

Then use npm scripts:
```bash
npm run watch      # Start watching all targets
npm run watch:cli  # Watch only CLI targets
npm run watch:mac  # Watch only Mac app targets
```

### Configuration Discovery

Poltergeist follows a simple configuration discovery pattern:

1. **Always reads from current directory**: `./poltergeist.config.json`
2. **No global config**: Each project has its own configuration
3. **No config inheritance**: Simple and predictable

```bash
# Example project structure
my-project/
├── poltergeist.config.json  # Poltergeist reads this
├── Package.swift
├── Sources/
└── Apps/

# Just cd and run
cd my-project
poltergeist haunt  # Automatically uses ./poltergeist.config.json
```

### Running Without Installation

Use `npx` to run Poltergeist without installing:

```bash
# Initialize a new project
npx @steipete/poltergeist init

# Start watching (uses local config)
npx @steipete/poltergeist haunt
```

### Programmatic API

For advanced use cases, Poltergeist can be used programmatically:

```javascript
import { Poltergeist, loadConfig } from '@steipete/poltergeist';
import { createLogger } from '@steipete/poltergeist';
import path from 'path';

async function startWatching() {
  // Load config from current directory
  const config = await loadConfig('./poltergeist.config.json');
  
  // Create logger
  const logger = createLogger('.poltergeist.log', 'info');
  
  // Create Poltergeist instance
  const poltergeist = new Poltergeist(
    config,
    process.cwd(),  // Project root
    logger,
    'all'           // Mode: 'cli', 'mac', or 'all'
  );
  
  // Start watching
  await poltergeist.start();
  
  // Check status
  const status = await poltergeist.status();
  console.log('Build status:', status);
  
  // Stop when done
  process.on('SIGINT', async () => {
    await poltergeist.stop();
    process.exit(0);
  });
}

startWatching().catch(console.error);
```

### TypeScript Support

Full TypeScript definitions are included:

```typescript
import type { 
  PoltergeistConfig, 
  BuildTarget, 
  BuildResult 
} from '@steipete/poltergeist';
```

### Publishing Updates

For maintainers publishing new versions:

```bash
# Update version
npm version patch  # or minor/major

# Build and test
npm run build
npm test

# Publish to npm
npm publish

# Publish beta version
npm publish --tag beta
```

## License

MIT License - see the [LICENSE](LICENSE) file for details.

---

*Universal file watcher and build automation tool*