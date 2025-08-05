# Bun Single Binary Distribution

## Overview

Poltergeist can be compiled into a standalone binary using Bun, eliminating the need for Node.js or npm installation. This creates a single executable that includes all dependencies and the Bun runtime, making distribution and deployment significantly simpler.

## Current Status

### ✅ Working
- **Single binary compilation**: Creates a 56.5MB standalone executable
- **Fast startup**: ~44ms cold start time
- **Cross-platform builds**: Can target Darwin (x64/arm64), Linux (x64/arm64), Windows (x64)
- **All features included**: File watching, building, daemon mode, etc.

### ⚠️ Limitations
- **No bytecode compilation**: Due to CommonJS dependencies (fb-watchman, pino, picomatch, etc.)
- **Binary size**: 56.5MB is larger than ideal due to bundled runtime
- **Platform-specific builds**: Need separate binaries for each OS/architecture

## Build Commands

```bash
# Build optimized native binary
npm run build:bun

# Build with benchmark
npm run build:bun:optimized:benchmark

# Build for all platforms
npm run build:bun:all

# Build debug version (without optimizations)
npm run build:bun:debug
```

## Binary Locations

Compiled binaries are stored in `dist-bun/`:
- `poltergeist` - Native optimized binary for current platform
- `poltergeist-{platform}` - Cross-compiled binaries for other platforms

## Distribution Strategy

### Option 1: GitHub Releases (Recommended)
Upload platform-specific binaries to GitHub releases. Users download the appropriate binary for their system:

```bash
# Download for macOS ARM64
curl -L https://github.com/steipete/poltergeist/releases/latest/download/poltergeist-darwin-arm64 -o poltergeist
chmod +x poltergeist
./poltergeist --version
```

### Option 2: npm with Binary Selection
Keep npm package with smart launcher that uses Bun binary when available:

```json
{
  "scripts": {
    "postinstall": "node scripts/install-binary.js"
  }
}
```

### Option 3: Homebrew/Package Managers
Create formulae for package managers that download the appropriate binary:

```ruby
class Poltergeist < Formula
  desc "The ghost that keeps your builds fresh"
  homepage "https://github.com/steipete/poltergeist"
  
  if Hardware::CPU.arm?
    url "https://github.com/steipete/poltergeist/releases/latest/download/poltergeist-darwin-arm64"
  else
    url "https://github.com/steipete/poltergeist/releases/latest/download/poltergeist-darwin-x64"
  end
end
```

## Conversion Plan

### Phase 1: Optimize Current Binary (Completed ✅)
- [x] Create Bun build scripts
- [x] Set up cross-platform compilation
- [x] Test binary performance
- [x] Replace Winston with Pino (reduced module count)

### Phase 2: Reduce Dependencies (In Progress)
Replace CommonJS dependencies to enable bytecode compilation:

| Dependency | Status | Alternative | Impact |
|------------|--------|-------------|--------|
| winston | ✅ Replaced | pino | -87 modules |
| fb-watchman | ❌ Blocking | chokidar/native fs.watch | Major refactor |
| node-notifier | ❌ Blocking | Native APIs/conditional load | Minor |
| picomatch | ❌ Blocking | micromatch/Bun glob | Minor |
| write-file-atomic | ❌ Blocking | Bun.write() | Minor |
| pino | ❌ CommonJS | Custom logger | Medium |

### Phase 3: Create Dual-Mode Architecture
Implement runtime detection for Bun-specific optimizations:

```typescript
// utils/runtime.ts
export const runtime = {
  isBun: typeof Bun !== 'undefined',
  isNode: typeof process !== 'undefined' && !Bun,
  
  // Atomic file write
  async writeAtomic(path: string, data: string) {
    if (this.isBun) {
      return Bun.write(path, data);
    } else {
      const writeFileAtomic = await import('write-file-atomic');
      return writeFileAtomic.default(path, data);
    }
  },
  
  // File watching
  watch(path: string, callback: Function) {
    if (this.isBun) {
      // Use Bun's native file watcher
      return Bun.fs.watch(path, callback);
    } else {
      // Use fb-watchman
      return watchmanClient.watch(path, callback);
    }
  }
};
```

### Phase 4: Implement Bytecode Compilation
Once all CommonJS dependencies are replaced or made optional:

```javascript
// scripts/build-bun.js
const buildArgs = [
  "build",
  "--compile",
  "--bytecode",  // Enable for faster startup
  "--minify",
  "--target", platform
];
```

Expected improvements:
- Startup time: ~44ms → ~15-20ms
- Binary size: Potentially smaller with better tree-shaking

### Phase 5: Automated Release Pipeline
Set up GitHub Actions for automated binary builds:

```yaml
# .github/workflows/release.yml
name: Release Binaries
on:
  release:
    types: [created]

jobs:
  build:
    strategy:
      matrix:
        target: [darwin-x64, darwin-arm64, linux-x64, linux-arm64, windows-x64]
    
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      
      - name: Build binary
        run: bun build --compile --target=${{ matrix.target }}
      
      - name: Upload to release
        uses: actions/upload-release-asset@v1
        with:
          asset_path: ./dist-bun/poltergeist-${{ matrix.target }}
```

## Usage Examples

### Direct Binary Usage
```bash
# No installation needed - just download and run
./poltergeist init
./poltergeist start
./polter my-app  # Smart wrapper included
```

### System-wide Installation
```bash
# Move to PATH
sudo mv poltergeist /usr/local/bin/
poltergeist --version
```

### Docker Distribution
```dockerfile
FROM scratch
COPY dist-bun/poltergeist-linux-x64 /poltergeist
ENTRYPOINT ["/poltergeist"]
```

## Performance Metrics

| Metric | Node.js | Bun (Current) | Bun (Bytecode) |
|--------|---------|---------------|----------------|
| Startup Time | ~200ms | ~44ms | ~15-20ms (projected) |
| Binary Size | N/A (needs Node) | 56.5MB | ~40MB (projected) |
| RAM Usage | ~50MB | ~30MB | ~25MB (projected) |
| Module Count | 338 | 251 | <100 (projected) |

## Migration Checklist

- [ ] Replace fb-watchman with ESM alternative
- [ ] Replace remaining CommonJS dependencies
- [ ] Enable bytecode compilation
- [ ] Set up automated release pipeline
- [ ] Create installation scripts for major platforms
- [ ] Update documentation for binary distribution
- [ ] Create Docker images with binary
- [ ] Set up Homebrew formula
- [ ] Add to other package managers (apt, yum, winget)

## Recommendations

1. **Current State is Usable**: The 44ms startup with 56.5MB binary is already production-ready
2. **Prioritize fb-watchman Replacement**: This is the biggest blocker for further optimization
3. **Consider Dual Distribution**: Keep npm for Node.js users, binaries for simplicity
4. **Focus on User Experience**: Binary distribution eliminates "npm install" friction

## Future Possibilities

- **Self-updating binaries**: Check for updates and self-replace
- **Embedded web UI**: Include a web interface in the binary
- **Plugin system**: Dynamic loading of compiled Bun plugins
- **Native OS integration**: System tray, native notifications, etc.