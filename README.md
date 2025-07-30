# 👻 Poltergeist

> The ghost that keeps your projects fresh

Poltergeist is a universal file watcher and auto-builder that supports any project type through a flexible target system. It watches your source files and automatically rebuilds when changes are detected.

## Features

- 🎯 **Generic Target System** - Support for any build type (executables, apps, libraries, docker, etc.)
- 👀 **Smart File Watching** - Powered by Facebook's Watchman for efficient file monitoring
- 🔔 **Build Notifications** - macOS notifications for build success/failure
- 🚀 **Fast Incremental Builds** - Only rebuild what changed
- 🔒 **Concurrent Build Protection** - Lock files prevent overlapping builds
- 📝 **Target-Specific Logging** - Clear logs showing which target is building
- ⚡ **Optimized Watch Patterns** - Shared watchers for overlapping paths

## Installation

```bash
npm install -g @steipete/poltergeist
```

Or use directly with npx:

```bash
npx @steipete/poltergeist haunt
```

## Quick Start

1. Create a `poltergeist.config.json` in your project root:

```json
{
  "targets": [
    {
      "name": "my-app",
      "type": "executable",
      "enabled": true,
      "buildCommand": "npm run build",
      "outputPath": "./dist/app",
      "watchPaths": ["src/**/*.ts", "src/**/*.js"]
    }
  ]
}
```

2. Start watching:

```bash
poltergeist haunt
```

## Configuration

### Target Types

Poltergeist supports multiple target types:

- `executable` - CLI tools, binaries
- `app-bundle` - macOS, iOS, tvOS, watchOS apps
- `library` - Static or dynamic libraries
- `framework` - Apple frameworks
- `test` - Test suites
- `docker` - Docker images
- `custom` - Custom target types via plugins

### Configuration Structure

```json
{
  "targets": [
    {
      "name": "unique-target-name",
      "type": "target-type",
      "enabled": true,
      "buildCommand": "command to build",
      "watchPaths": ["patterns/**/*.ext"],
      "statusFile": "/tmp/build-status.json",
      "lockFile": "/tmp/build.lock",
      "settlingDelay": 1000,
      "environment": {
        "KEY": "value"
      }
    }
  ],
  "notifications": {
    "enabled": true,
    "successSound": "Glass",
    "failureSound": "Basso",
    "buildStart": true,
    "buildFailed": true,
    "buildSuccess": true,
    "minInterval": 5000
  },
  "logging": {
    "file": ".poltergeist.log",
    "level": "info"
  }
}
```

### Global Configuration

The global configuration options control Poltergeist's behavior across all targets:

#### Notifications
- `enabled`: Enable/disable all notifications
- `successSound`: macOS sound for successful builds (e.g., "Glass", "Ping")
- `failureSound`: macOS sound for failed builds (e.g., "Basso", "Funk")
- `buildStart`: Show notification when build starts
- `buildFailed`: Show notification when build fails
- `buildSuccess`: Show notification when build succeeds
- `minInterval`: Minimum milliseconds between notifications

#### Logging
- `file`: Path to the log file
- `level`: Log level (debug, info, warn, error)

### Target-Specific Options

#### Executable Targets
```json
{
  "type": "executable",
  "outputPath": "./path/to/binary"
}
```

#### App Bundle Targets
```json
{
  "type": "app-bundle",
  "platform": "macos",
  "bundleId": "com.example.app",
  "autoRelaunch": true,
  "launchCommand": "open -b com.example.app"
}
```

## CLI Commands

```bash
# Start watching (all enabled targets)
poltergeist haunt

# Watch specific target
poltergeist haunt --target my-app

# Check status
poltergeist status
poltergeist status --target my-app

# Stop watching
poltergeist stop

# List all targets
poltergeist list

# View logs
poltergeist logs
poltergeist logs --follow
```

## Real-World Example

Here's how [Peekaboo](https://github.com/steipete/peekaboo) uses Poltergeist:

```json
{
  "targets": [
    {
      "name": "peekaboo-cli",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./scripts/build-swift-debug.sh",
      "outputPath": "./peekaboo",
      "watchPaths": [
        "Core/PeekabooCore/**/*.swift",
        "Core/AXorcist/**/*.swift",
        "Apps/CLI/**/*.swift"
      ]
    },
    {
      "name": "peekaboo-mac",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "buildCommand": "./scripts/build-mac-debug.sh",
      "bundleId": "boo.peekaboo",
      "autoRelaunch": true,
      "watchPaths": [
        "Apps/Mac/**/*.swift",
        "Apps/Mac/**/*.storyboard",
        "Core/**/*.swift"
      ]
    }
  ]
}
```

## Migration from Old Format

**⚠️ Breaking Change**: The old `cli` and `macApp` configuration format is no longer supported.

See [MIGRATION.md](MIGRATION.md) for detailed migration instructions.

## Environment Variables

- `POLTERGEIST_NOTIFICATIONS=false` - Disable build notifications
- `POLTERGEIST_LOG_LEVEL=debug` - Override log level

## Requirements

- Node.js 16+
- [Watchman](https://facebook.github.io/watchman/) (installed automatically via npm)
- macOS (for notifications and app relaunching)

## Development

```bash
# Clone the repository
git clone https://github.com/steipete/poltergeist.git
cd poltergeist

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Watch for changes
npm run dev
```

## License

MIT © Peter Steinberger

## Contributing

Contributions are welcome! Please read our [Contributing Guide](CONTRIBUTING.md) for details.

## Acknowledgments

- Built with [Watchman](https://facebook.github.io/watchman/) for efficient file watching
- Inspired by the need for a universal, flexible build watcher
- Ghost emoji because why not 👻