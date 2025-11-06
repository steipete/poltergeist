# Configuration Guide

Poltergeist can auto-detect most projects, but it also supports detailed manual tuning. This guide aggregates the configuration, logging, CMake, and state-management notes that were previously part of the README.

## Automatic Project Detection

Run `poltergeist init` (or `--auto`) to:

- Detect project type (Swift, Node.js, Rust, Python, CMake, etc.)
- Infer build commands and output paths
- Configure watch patterns and exclusions
- Generate `poltergeist.config.json`

Common indicators:

- `Package.swift` → Swift Package Manager
- `package.json` → Node.js/npm
- `Cargo.toml` → Rust/Cargo
- `CMakeLists.txt` → CMake
- `pyproject.toml` → Python projects

## Configuration Schema

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
  "notifications": { "enabled": true },
  "logging": { "level": "info", "file": ".poltergeist.log" }
}
```

### Logging System (v1.8.0+)

- Separate file per target at `/tmp/poltergeist/{projectName}-{hash}-{target}.log`
- Plain text with `timestamp level: message`
- New file each build, no rotation required

### Watchman Optimisation

- Brace expansion reduces redundant patterns (`foo/{bar,baz}/**/*.c`)
- Excess patterns trimmed to the most critical ones (balanced profile defaults)
- Exclusions capped (50 by default) to avoid Watchman penalties

## Advanced Features

### CMake Support

- `poltergeist init --cmake` analyses targets and generates matching builders.
- Supports custom generators (`--generator Ninja`) and presets (`--preset debug`).
- Automatically re-runs `cmake` when `CMakeLists.txt` changes.
- Uses `cmake --build --parallel` by default.

Example:

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

### Watch Pattern Optimisation

Before:

```json
"watchPaths": [
  "spine-c-unit-tests/memory/**/*.{c,cpp,h}",
  "spine-c-unit-tests/minicppunit/**/*.{c,cpp,h}",
  "spine-c-unit-tests/tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}"
]
```

After optimisation:

```json
"watchPaths": [
  "spine-c-unit-tests/**/*.{c,cpp,h}",
  "spine-c/include/**/*.{c,cpp,h}",
  "spine-c/src/**/*.{c,cpp,h}"
]
```

## Architecture Snapshot

Poltergeist uses a distributed model—each project has its own daemon process. Global commands (`status`, `clean`) scan `/tmp/poltergeist/` for active state files. The macOS app observes the same directory, so CLI and GUI stay synchronised without direct IPC.

For full diagrams, refer to [`docs/architecture.md`](./architecture.md).

## State Management & Logging

- State files live in `/tmp/poltergeist/` (or `%TEMP%\poltergeist\` on Windows).
- Naming pattern: `{projectName}-{hash}-{target}.state`
- Files are written atomically (temp file + rename) to avoid partial reads.
- `poltergeist clean` removes stale state when the heartbeat stops updating.

These state files are designed for tooling integration—scripts, IDE plug-ins, CI jobs and the macOS app all read the same JSON snapshot.
