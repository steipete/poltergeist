# Poltergeist

[![CI](https://github.com/steipete/poltergeist/actions/workflows/ci.yml/badge.svg)](https://github.com/steipete/poltergeist/actions/workflows/ci.yml)
[![Node.js Version](https://img.shields.io/node/v/@steipete/poltergeist)](https://nodejs.org)
[![npm version](https://img.shields.io/npm/v/@steipete/poltergeist)](https://www.npmjs.com/package/@steipete/poltergeist)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A universal file watcher and auto-builder that supports any project type through a flexible target system. Poltergeist monitors your source files and automatically rebuilds when changes are detected, supporting any language or build system.

## Features

- **Universal Target System**: Support for any build type including executables, applications, libraries, Docker containers, and custom build processes
- **Efficient File Watching**: Powered by Facebook's Watchman for high-performance file monitoring with minimal CPU usage
- **Build Notifications**: Native macOS notifications for build status updates
- **State Management**: Unified state system with process tracking, build history, and heartbeat monitoring
- **Concurrent Build Protection**: Intelligent lock management prevents overlapping builds
- **Multi-Target Support**: Build multiple targets simultaneously with independent configuration
- **Environment Variables**: Full support for custom environment variables per target
- **Cross-Platform**: Works on macOS, Linux, and Windows (with platform-specific features)

## Requirements

- Node.js 20.0.0 or higher
- [Watchman](https://facebook.github.io/watchman/) (automatically installed as a dependency)
- macOS for notification features (optional)

## Installation

Install globally via npm:

```bash
npm install -g @steipete/poltergeist
```

Or run directly using npx:

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
      "watchPaths": ["src/**/*.ts", "src/**/*.js"],
      "settlingDelay": 100
    }
  ]
}
```

2. Start watching:

```bash
poltergeist haunt
```

## Configuration

### Configuration File Structure

Poltergeist uses a JSON configuration file (`poltergeist.config.json`) to define build targets and global settings:

```json
{
  "targets": [
    {
      "name": "target-name",
      "type": "executable|app-bundle",
      "enabled": true,
      "buildCommand": "build command",
      "watchPaths": ["glob/patterns/**/*.ext"],
      "outputPath": "./path/to/output",
      "settlingDelay": 100,
      "environment": {
        "ENV_VAR": "value"
      }
    }
  ],
  "notifications": {
    "enabled": true,
    "buildStart": true,
    "buildSuccess": true,
    "buildFailed": true
  }
}
```

### Target Configuration

Each target supports the following properties:

| Property | Type | Required | Description |
|----------|------|----------|-------------|
| `name` | string | Yes | Unique identifier for the target |
| `type` | string | Yes | Target type: `executable` or `app-bundle` |
| `enabled` | boolean | No | Whether the target is active (default: true) |
| `buildCommand` | string | Yes | Command to execute for building |
| `watchPaths` | string[] | Yes | Glob patterns for files to watch |
| `outputPath` | string | No | Path to the build output |
| `settlingDelay` | number | No | Milliseconds to wait before building after changes (default: 100) |
| `environment` | object | No | Environment variables for the build process |

### Target Types

#### Executable Target

For CLI tools, binaries, and general build processes:

```json
{
  "type": "executable",
  "buildCommand": "cargo build --release",
  "outputPath": "./target/release/myapp"
}
```

#### App Bundle Target

For macOS, iOS, and other Apple platform applications:

```json
{
  "type": "app-bundle",
  "platform": "macos",
  "bundleId": "com.example.app",
  "buildCommand": "xcodebuild -scheme MyApp",
  "autoRelaunch": true
}
```

Additional properties for app-bundle targets:

| Property | Type | Description |
|----------|------|-------------|
| `platform` | string | Target platform: `macos`, `ios`, `tvos`, `watchos`, `visionos` |
| `bundleId` | string | Application bundle identifier |
| `autoRelaunch` | boolean | Automatically relaunch the app after building |

### Global Configuration

Configure notifications and logging behavior:

```json
{
  "notifications": {
    "enabled": true,
    "buildStart": true,
    "buildSuccess": true,
    "buildFailed": true
  }
}
```

## Command Line Interface

### Commands

| Command | Description |
|---------|-------------|
| `poltergeist haunt [options]` | Start watching and building |
| `poltergeist stop [options]` | Stop all Poltergeist processes |
| `poltergeist status [options]` | Display current build status |
| `poltergeist list` | List all configured targets |
| `poltergeist clean` | Remove stale state files |
| `poltergeist logs [options]` | Display build logs |

### Options

#### haunt/start
- `-t, --target <name>`: Build only a specific target
- `-c, --config <path>`: Custom configuration file path
- `-v, --verbose`: Enable verbose logging

#### stop
- `-t, --target <name>`: Stop only a specific target
- `-a, --all`: Stop all targets across all projects

#### status
- `-t, --target <name>`: Show status for a specific target
- `-v, --verbose`: Show detailed status information

#### logs
- `-t, --target <name>`: Show logs for a specific target
- `-f, --follow`: Follow log output in real-time
- `-n, --lines <number>`: Number of lines to display

## State Management

Poltergeist maintains state files in `/tmp/poltergeist/` with the following structure:

- Process information with PID and hostname
- Build status and history
- Application metadata (for app-bundle targets)
- Heartbeat monitoring for process health

State files are automatically cleaned up when processes exit gracefully.

## Examples

### TypeScript/JavaScript Project

```json
{
  "targets": [
    {
      "name": "frontend",
      "type": "executable",
      "buildCommand": "npm run build",
      "watchPaths": ["src/**/*.{ts,tsx,js,jsx}", "public/**/*"],
      "outputPath": "./dist"
    },
    {
      "name": "backend",
      "type": "executable",
      "buildCommand": "tsc && node dist/server.js",
      "watchPaths": ["server/**/*.ts"],
      "environment": {
        "NODE_ENV": "development"
      }
    }
  ]
}
```

### Rust Project

```json
{
  "targets": [
    {
      "name": "rust-app",
      "type": "executable",
      "buildCommand": "cargo build --release",
      "watchPaths": ["src/**/*.rs", "Cargo.toml"],
      "outputPath": "./target/release/myapp"
    }
  ]
}
```

### Xcode Project

```json
{
  "targets": [
    {
      "name": "ios-app",
      "type": "app-bundle",
      "platform": "ios",
      "bundleId": "com.example.iosapp",
      "buildCommand": "xcodebuild -scheme MyApp -sdk iphonesimulator",
      "watchPaths": ["MyApp/**/*.swift", "MyApp/**/*.storyboard"]
    }
  ]
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

# Build the project
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
│   ├── builders/         # Build target implementations
│   ├── cli.ts           # Command-line interface
│   ├── config.ts        # Configuration management
│   ├── poltergeist.ts   # Core application logic
│   ├── state.ts         # State management
│   └── watchman.ts      # File watching integration
├── test/                # Test files
├── dist/                # Compiled output
└── poltergeist.config.json
```

### Testing

The project uses Vitest for testing with comprehensive test coverage:

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

### Code Quality

The project uses Biome for linting and formatting:

```bash
# Run linter
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format

# Type checking
npm run typecheck
```

## Contributing

Contributions are welcome! Please follow these guidelines:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

Please ensure:
- All tests pass (`npm test`)
- Code is properly formatted (`npm run format`)
- Linting passes (`npm run lint`)
- Type checking passes (`npm run typecheck`)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

Created and maintained by [Peter Steinberger](https://github.com/steipete)

## Acknowledgments

- Built with [Watchman](https://facebook.github.io/watchman/) for efficient file watching
- Inspired by the need for a universal, language-agnostic build automation tool
- Special thanks to all contributors and users who have helped improve Poltergeist