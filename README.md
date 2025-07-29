# Poltergeist 👻

> The ghost that keeps your projects fresh

Poltergeist is a universal file watcher and automatic build system for any project. It monitors your source files and automatically rebuilds your CLI tools, applications, or any project whenever you save changes. No more manual rebuilding, no more stale binaries, no more wasted time.

## Why Poltergeist vs Watchman?

While Poltergeist uses Facebook's Watchman internally for efficient file watching, it provides a complete development automation solution that goes far beyond what Watchman offers:

### Watchman = Low-Level File Watching
- Only notifies you when files change
- Requires custom scripts to trigger builds
- No built-in error handling or retries
- Manual integration with build systems
- No notification system

### Poltergeist = Complete Build Automation
- **Automatic Build Triggering** - Runs your build commands when files change
- **Multi-Target Support** - Manage CLI tools and Mac apps in one config
- **Build Status Tracking** - JSON status files for tool integration
- **Mac App Hot Reload** - Auto quit/relaunch apps after builds
- **Smart Queuing** - Batches changes, prevents redundant builds
- **Native Notifications** - Success/failure alerts with custom sounds
- **Robust Error Handling** - Automatic retries with exponential backoff
- **Zero Config** - Works with any build system out of the box
- **Developer Experience** - Simple CLI, status monitoring, verbose logging

Think of it this way: Watchman tells you "these files changed", while Poltergeist handles the entire "files changed → rebuild → notify → relaunch app" workflow automatically.

## Features

- 🔄 **Automatic Rebuilding** - Detects file changes and rebuilds immediately
- 🎯 **Dual Mode Support** - Works with any build system (Make, CMake, Cargo, npm, gradle, etc.)
- 🚀 **Auto-Relaunch** - Automatically quits and relaunches Mac apps after successful builds
- 📊 **Build Status Tracking** - JSON-based status files for integration with other tools
- 🔔 **Native Notifications** - macOS notifications with sound for build success/failure
- 🎨 **Smart Error Handling** - Clear error messages and recovery instructions
- ⚡ **High Performance** - Built on Facebook's Watchman for efficient file watching
- 🔧 **Configurable** - JSON configuration with full TypeScript validation
- 📦 **Zero Dependencies** - Only requires Node.js and Watchman

## Installation

### Prerequisites

1. **Node.js** (v18 or later)
   ```bash
   brew install node
   ```

2. **Watchman** (Facebook's file watching service)
   ```bash
   brew install watchman
   ```

### Install Poltergeist

```bash
# Clone or navigate to your project
cd /path/to/your/project

# Install Poltergeist dependencies
cd tools/poltergeist
npm install

# Build TypeScript
npm run build

# Make executable
chmod +x poltergeist
```

## Quick Start

### 1. Initialize Configuration

```bash
./poltergeist init
```

This creates a `poltergeist.config.json` file in your project root. Edit it to match your project:

```json
{
  "targets": [
    {
      "name": "My CLI Tool",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./scripts/build-debug.sh",
      "outputPath": "./my-cli",
      "statusFile": "/tmp/my-cli-build-status.json",
      "lockFile": "/tmp/my-cli-build.lock",
      "settlingDelay": 1000,
      "debounceInterval": 2000,
      "watchPaths": [
        "src/**/*",
        "Makefile"
      ]
    },
    {
      "name": "My Mac App",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "buildCommand": "xcodebuild -workspace MyApp.xcworkspace -scheme MyApp build",
      "bundleId": "com.example.myapp",
      "autoRelaunch": true,
      "settlingDelay": 1000,
      "debounceInterval": 2000,
      "watchPaths": [
        "MyApp/**/*",
        "Resources/**/*"
      ]
    }
  ],
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso"
  }
}
```

### 2. Start Watching

```bash
# Watch all enabled targets
./poltergeist haunt

# Watch only CLI
./poltergeist haunt --cli

# Watch only Mac app
./poltergeist haunt --mac
```

### 3. Check Status

```bash
./poltergeist status
```

## Configuration

### Target Configuration

Each target in the `targets` array supports these fields:

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Display name for notifications and logs |
| `type` | string | Target type: `"executable"` or `"app-bundle"` |
| `platform` | string | Platform (optional): `"macos"`, `"ios"`, `"linux"`, `"windows"` |
| `enabled` | boolean | Enable/disable this target |
| `buildCommand` | string | Command to build your target |
| `outputPath` | string | Path to the built binary (for executables) |
| `bundleId` | string | Bundle identifier (for app bundles) |
| `autoRelaunch` | boolean | Auto quit/relaunch app after build (app bundles only) |
| `statusFile` | string | Path to build status JSON file |
| `lockFile` | string | Path to build lock file |
| `watchPaths` | string[] | Glob patterns for files to watch |
| `settlingDelay` | number | Milliseconds to wait after file changes stop (default: 1000) |
| `debounceInterval` | number | Minimum milliseconds between builds (default: 2000) |
| `maxRetries` | number | Max build retry attempts (default: 3) |
| `backoffMultiplier` | number | Retry delay multiplier (default: 2) |

### Global Configuration

```json
{
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso",
    "buildStart": true,        // Show notification when build starts
    "buildFailed": true,       // Show notification when build fails
    "buildSuccess": true,      // Show notification when build succeeds
    "minInterval": 5000        // Minimum milliseconds between notifications
  },
  "logging": {
    "file": ".poltergeist.log",
    "level": "info"  // debug, info, warn, error
  }
}
```

## Usage Examples

### Basic CLI Project (any language)

```json
{
  "targets": [
    {
      "name": "My Tool",
      "type": "executable",
      "enabled": true,
      "buildCommand": "make debug",
      "outputPath": "./bin/my-tool",
      "watchPaths": ["src/**/*", "Makefile", "*.h"]
    }
  ]
}
```

### Xcode Mac App Project

```json
{
  "targets": [
    {
      "name": "My App",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "buildCommand": "xcodebuild -project MyApp.xcodeproj -scheme MyApp -configuration Debug build",
      "bundleId": "com.mycompany.myapp",
      "autoRelaunch": true,
      "watchPaths": ["MyApp/**/*", "*.xib", "*.storyboard"]
    }
  ]
}
```

### Multi-Target Project

```json
{
  "targets": [
    {
      "name": "CLI Tool",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./scripts/build-cli.sh",
      "outputPath": "./bin/cli-tool",
      "watchPaths": ["CLI/**/*", "Shared/**/*", "include/**/*.h"]
    },
    {
      "name": "Mac App",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "buildCommand": "./scripts/build-app.sh",
      "bundleId": "com.example.app",
      "autoRelaunch": true,
      "watchPaths": ["App/**/*", "Shared/**/*", "Resources/**/*"]
    }
  ]
}
```

## Build Status Integration

Poltergeist writes build status to JSON files that other tools can read:

```json
{
  "status": "success",  // "idle", "building", "success", "failed"
  "timestamp": "2025-07-29T19:40:00Z",
  "gitHash": "abc123",
  "errorSummary": "",
  "builder": "poltergeist",
  "buildTime": 12300  // milliseconds
}
```

### Example: Smart CLI Wrapper

```bash
#!/bin/bash
# Wait for Poltergeist to finish building before running

BUILD_STATUS="/tmp/my-cli-build-status.json"
MAX_WAIT=180

# Check if build is in progress
if [ -f "$BUILD_STATUS" ]; then
  STATUS=$(jq -r '.status' "$BUILD_STATUS" 2>/dev/null)
  
  if [ "$STATUS" = "building" ]; then
    echo "⏳ Waiting for build to complete..."
    
    # Wait for build to finish
    WAITED=0
    while [ "$STATUS" = "building" ] && [ $WAITED -lt $MAX_WAIT ]; do
      sleep 1
      STATUS=$(jq -r '.status' "$BUILD_STATUS" 2>/dev/null)
      ((WAITED++))
    done
  fi
  
  if [ "$STATUS" = "failed" ]; then
    echo "❌ Build failed!"
    ERROR=$(jq -r '.errorSummary' "$BUILD_STATUS" 2>/dev/null)
    echo "$ERROR"
    exit 1
  fi
fi

# Run the CLI
exec ./my-cli "$@"
```

## Debouncing and Build Control

Poltergeist provides fine-grained control over build timing to prevent excessive builds and notification spam:

### Two-Level Debouncing

1. **File Change Debouncing (`settlingDelay`)**
   - Waits for file changes to "settle" before starting a build
   - Default: 1000ms (1 second)
   - Useful when your editor saves multiple files in quick succession

2. **Build Queue Debouncing (`debounceInterval`)**
   - Minimum time between builds for each target
   - Default: 2000ms (2 seconds)
   - Prevents rapid rebuilds when many files change
   - Each target has its own debounce timer

### Notification Control

Separate from build debouncing, notification timing is controlled globally:

- **`minInterval`**: Minimum time between any notifications (default: 5000ms)
- **`buildStart`**: Enable/disable build start notifications
- **`buildFailed`**: Enable/disable build failure notifications
- **`buildSuccess`**: Enable/disable build success notifications

### Example: Optimized for Rapid Development

```json
{
  "targets": [
    {
      "name": "My CLI",
      "type": "executable",
      "buildCommand": "./build.sh",
      "settlingDelay": 500,        // Quick 0.5s settle time
      "debounceInterval": 3000,     // 3s minimum between builds
      "watchPaths": ["src/**/*"]
    }
  ],
  "notifications": {
    "enabled": true,
    "buildStart": false,          // No start notifications
    "buildFailed": true,          // Only show failures
    "buildSuccess": true,         // And successes
    "minInterval": 10000          // Max 1 notification per 10s
  }
}
```

### Example: Stable Production Builds

```json
{
  "targets": [
    {
      "name": "Production App",
      "type": "app-bundle",
      "buildCommand": "make release",
      "settlingDelay": 2000,        // Wait 2s for all changes
      "debounceInterval": 10000,    // 10s minimum between builds
      "watchPaths": ["src/**/*", "resources/**/*"]
    }
  ],
  "notifications": {
    "enabled": true,
    "buildStart": true,           // Show all notifications
    "buildFailed": true,
    "buildSuccess": true,
    "minInterval": 5000           // Standard 5s between notifications
  }
}
```

## Advanced Features

### Custom Build Scripts

Poltergeist can run any build command. Create wrapper scripts for complex builds:

```bash
#!/bin/bash
# scripts/build-with-env.sh

export MY_BUILD_FLAG=1
export BUILD_TYPE=debug
export CFLAGS="-g -O0"

make $BUILD_TYPE
```

### Notification Control

Disable notifications temporarily:
```bash
POLTERGEIST_NOTIFICATIONS=false ./poltergeist haunt
```

### Debug Mode

Enable verbose logging:
```bash
./poltergeist haunt --verbose
```

Or in config:
```json
{
  "logging": {
    "level": "debug"
  }
}
```

## Architecture

Poltergeist is built with TypeScript for maintainability and extensibility:

- **Watchman Integration** - Native Node.js bindings for efficient file watching
- **Modular Design** - Separate concerns for watching, building, and notifications
- **Type Safety** - Full TypeScript with Zod schema validation
- **Async/Await** - Modern async patterns for reliability
- **Process Management** - Proper handling of build processes and cancellation

## Troubleshooting

### Watchman Not Found

```bash
brew install watchman
```

### Permission Denied

```bash
chmod +x poltergeist
chmod +x your-build-script.sh
```

### Build Keeps Failing

1. Check your build command works manually
2. Look at `.poltergeist.log` for detailed errors
3. Ensure all paths in config are correct
4. Try with `--verbose` flag

### Auto-Relaunch Not Working

1. Verify the `bundleId` is correct
2. Check the app is actually installed
3. Ensure the app has proper permissions

## Contributing

Poltergeist is part of the Peekaboo project. To contribute:

1. Fork the repository
2. Create a feature branch
3. Make your changes with tests
4. Submit a pull request

## License

MIT License - See LICENSE file in the project root

## Credits

Built with ❤️ for developers everywhere by the Peekaboo team.

Powered by:
- [Watchman](https://facebook.github.io/watchman/) - Facebook's file watching service
- [Commander.js](https://github.com/tj/commander.js/) - Node.js command-line interfaces
- [Chalk](https://github.com/chalk/chalk) - Terminal string styling
- [Winston](https://github.com/winstonjs/winston) - Logging library
- [Zod](https://github.com/colinhacks/zod) - TypeScript-first schema validation