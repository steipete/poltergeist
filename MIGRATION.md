# Poltergeist Migration Guide - Generic Target System

## Breaking Changes

Poltergeist has moved to a generic target system that replaces the hardcoded `cli` and `macApp` configuration sections. **There is no backward compatibility** - you must update your configuration immediately.

## Configuration Changes

### Old Format (No Longer Supported)
```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "./build.sh",
    "outputPath": "./bin/myapp",
    "watchPaths": ["src/**/*.js"]
  },
  "macApp": {
    "enabled": true,
    "buildCommand": "./build-app.sh",
    "bundleId": "com.example.myapp",
    "watchPaths": ["app/**/*.swift"]
  }
}
```

### New Format (Required)
```json
{
  "targets": [
    {
      "name": "my-cli",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./build.sh",
      "outputPath": "./bin/myapp",
      "watchPaths": ["src/**/*.js"]
    },
    {
      "name": "my-mac-app",
      "type": "app-bundle",
      "platform": "macos",
      "enabled": true,
      "buildCommand": "./build-app.sh",
      "bundleId": "com.example.myapp",
      "autoRelaunch": true,
      "watchPaths": ["app/**/*.swift"]
    }
  ]
}
```

## CLI Changes

### Old Commands
```bash
poltergeist haunt --cli        # Build CLI only
poltergeist haunt --mac        # Build Mac app only
poltergeist status --cli       # CLI status
poltergeist status --mac       # Mac app status
```

### New Commands
```bash
poltergeist haunt --target my-cli      # Build specific target
poltergeist haunt                      # Build all enabled targets
poltergeist status --target my-cli     # Specific target status
poltergeist status                     # All targets status
poltergeist list                       # List all configured targets
```

## Target Types

The new system supports multiple target types:

- `executable` - CLI tools, binaries
- `app-bundle` - macOS, iOS, tvOS, watchOS apps
- `library` - Static or dynamic libraries
- `framework` - Apple frameworks
- `test` - Test suites
- `docker` - Docker images
- `custom` - Custom target types via plugins

## Migration Steps

1. **Update Configuration File**
   - Replace `cli` section with executable target in `targets` array
   - Replace `macApp` section with app-bundle target in `targets` array
   - Give each target a unique, descriptive name

2. **Update Scripts**
   - Replace `--cli` with `--target your-cli-name`
   - Replace `--mac` with `--target your-app-name`

3. **Update CI/CD**
   - Update any automation that uses the old flags
   - Consider using target names that describe their purpose

## Benefits

- **Flexibility**: Support any number of targets
- **Extensibility**: Easy to add new target types
- **Clarity**: Descriptive target names instead of generic flags
- **Multi-platform**: Better support for iOS, tvOS, watchOS targets
- **Future-proof**: Plugin system for custom build types

## Error Messages

If you try to use the old configuration format, you'll see:

```
❌ Old configuration format detected!

Poltergeist now uses a "targets" array instead of "cli" and "macApp" sections.

Please update your poltergeist.config.json to the new format:
[example configuration shown]
```

## Example: Peekaboo Configuration

Here's how Peekaboo's configuration was migrated:

```json
{
  "targets": [
    {
      "name": "peekaboo-cli",
      "type": "executable",
      "enabled": true,
      "buildCommand": "./scripts/build-swift-debug.sh",
      "outputPath": "./peekaboo",
      "statusFile": "/tmp/peekaboo-cli-build-status.json",
      "lockFile": "/tmp/peekaboo-cli-build.lock",
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
      "statusFile": "/tmp/peekaboo-mac-build-status.json",
      "lockFile": "/tmp/peekaboo-mac-build.lock",
      "autoRelaunch": true,
      "watchPaths": [
        "Apps/Mac/Peekaboo/**/*.swift",
        "Apps/Mac/Peekaboo/**/*.storyboard",
        "Apps/Mac/Peekaboo/**/*.xib",
        "Core/PeekabooCore/**/*.swift",
        "Core/AXorcist/**/*.swift"
      ]
    }
  ],
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