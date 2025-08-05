# Poltergeist Examples

This directory contains example configurations and minimal test projects for Poltergeist v1.0.

## Test Projects (E2E Testing)

These are minimal, runnable projects for end-to-end testing:

### c-hello/
Simple C program demonstrating basic file watching and Makefile builds.
```bash
cd c-hello && make && ./hello
```

### node-typescript/
TypeScript Node.js app testing npm build integration.
```bash
cd node-typescript && npm install && npm run build && npm start
```

### cmake-library/
CMake static library with tests, demonstrating automatic target detection.
```bash
cd cmake-library && cmake -B build && cmake --build build && ./build/test_mathlib
```

## Running E2E Tests

```bash
./run-all-examples.sh  # Run all example projects
```

## Configuration Examples

Copy these to your project as `poltergeist.config.json`:

### Swift Package Manager (`swift-spm.poltergeist.config.json`)

**Use for**: Swift CLI tools, libraries, and SPM-based projects

**Features**:
- Release and debug build targets
- Automatic test running
- Swift-optimized exclusions
- Xcode integration support

**Key settings**:
- Project type: `swift`
- Performance profile: `balanced`
- Watches: `Sources/**/*.swift`, `Package.swift`

### Node.js Project (`nodejs.poltergeist.config.json`)

**Use for**: React apps, Express servers, TypeScript projects

**Features**:
- Separate webapp and API server builds
- Test automation
- Lint checking (optional)
- Node.js optimized exclusions

**Key settings**:
- Project type: `node`
- Performance profile: `balanced`
- Watches: TypeScript, JavaScript, and config files

### Mixed Language Project (`mixed-project.poltergeist.config.json`)

**Use for**: Full-stack applications with multiple technologies

**Features**:
- Swift backend + React frontend + macOS app
- Cross-language shared code watching
- Integration test support
- API documentation generation

**Key settings**:
- Project type: `mixed`
- Performance profile: `aggressive`
- Multiple target types: executable, app-bundle, custom

### Rust Project (`rust.poltergeist.config.json`)

**Use for**: Rust applications, CLI tools, and libraries

**Features**:
- Release and debug builds
- Test and benchmark automation
- Clippy linting integration
- Rust-optimized exclusions

**Key settings**:
- Project type: `rust`
- Performance profile: `balanced`
- Watches: `src/**/*.rs`, `Cargo.toml`

### Docker Development (`docker-dev.poltergeist.config.json`)

**Use for**: Containerized development environments

**Features**:
- Multi-service Docker builds
- Frontend and API containers
- Database container support
- Docker Compose integration

**Key settings**:
- Project type: `node` (host)
- Performance profile: `conservative`
- Docker-specific exclusions and longer timeouts

## Configuration Patterns

### Target Types

| Type | Use For | Example |
|------|---------|---------|
| `executable` | CLI tools, binaries | Swift CLI, Rust binary |
| `app-bundle` | macOS/iOS apps | Xcode projects |
| `library` | Static/dynamic libs | Swift packages |
| `framework` | macOS frameworks | Xcode frameworks |
| `test` | Test suites | Unit tests, integration tests |
| `docker` | Container builds | API containers |
| `custom` | Special builds | Documentation, linting |

### Performance Profiles

| Profile | Max Exclusions | Use Case |
|---------|----------------|----------|
| `conservative` | 20 | Small projects, debugging |
| `balanced` | 50 | Most projects (recommended) |
| `aggressive` | 100 | Large projects, CI/CD |

### Watch Path Patterns

```json
{
  "watchPaths": [
    "src/**/*.{ts,tsx,js,jsx}",  // Multiple extensions
    "**/*.swift",                // Recursive Swift files
    "Sources/**/*.swift",        // Specific directory
    "Package.swift",             // Single file
    "!**/node_modules/**"        // Exclusion (handled by excludeDirs)
  ]
}
```

### Environment Variables

```json
{
  "environment": {
    "NODE_ENV": "development",
    "API_URL": "http://localhost:3001",
    "DEBUG": "app:*",
    "RUST_LOG": "debug"
  }
}
```

## Customization Guide

### 1. Project Detection

Poltergeist automatically detects project type based on files:
- `Package.swift` → `swift`
- `package.json` → `node`
- `Cargo.toml` → `rust`
- `pyproject.toml` → `python`
- Multiple indicators → `mixed`

### 2. Build Commands

Customize build commands for your project:

```json
{
  "buildCommand": "swift build -c release --arch arm64"
}
```

### 3. Watch Paths

Be specific with watch paths to avoid unnecessary rebuilds:

```json
{
  "watchPaths": [
    "src/**/*.swift",     // Source files
    "Resources/**/*",     // Resources
    "Package.swift"       // Config files
  ]
}
```

### 4. Timing Configuration

Adjust timing for your project's needs:

```json
{
  "settlingDelay": 1000,      // Wait after file changes
  "debounceInterval": 5000,   // Prevent rapid rebuilds
  "maxRetries": 3             // Retry failed builds
}
```

### 5. Exclusions

Add project-specific exclusions:

```json
{
  "watchman": {
    "excludeDirs": [
      "logs",
      "tmp_*",
      "custom_cache"
    ],
    "rules": [
      {
        "pattern": "**/test_output/**",
        "action": "ignore",
        "reason": "Test artifacts"
      }
    ]
  }
}
```

## Testing Examples

Test each configuration:

```bash
# Copy example to your project
cp examples/swift-spm.poltergeist.config.json ./poltergeist.config.json

# Validate configuration
poltergeist list

# Start watching (dry run first)
poltergeist haunt --verbose

# Check status
poltergeist status

# Stop when done
poltergeist stop
```

## Best Practices

1. **Start with an example** closest to your project type
2. **Enable only needed targets** initially
3. **Use appropriate performance profile** for project size
4. **Test timing settings** with your build speed
5. **Monitor logs** for optimization opportunities
6. **Customize exclusions** based on your project structure

## Troubleshooting

### Build Too Slow
- Increase `debounceInterval`
- Use `aggressive` performance profile
- Add more exclusions

### Missing File Changes
- Check `watchPaths` patterns
- Verify exclusions aren't too broad
- Use `conservative` performance profile

### Too Many Rebuilds
- Increase `settlingDelay`
- Check for file generation loops
- Add exclusions for generated files

For more help, see the main [README.md](../README.md) and run `poltergeist --help`.