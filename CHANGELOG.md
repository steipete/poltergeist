# Changelog

All notable changes to Poltergeist will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2025-01-06

### Added
- Enhanced status command with `--verbose` / `-v` flag for detailed build information
  - Process uptime and start time display
  - Build exit codes for failed builds
  - Full build command visibility
  - Comprehensive build statistics (average, minimum, and maximum durations)
  - Recent successful builds history with timestamps
- Git hooks for preventing large file commits
  - Automatic detection of files larger than 100MB
  - Pre-commit validation to maintain repository health
- NPM builder support for Node.js projects
  - Automatic package.json detection
  - Integrated npm script execution
- Self-building capability for Poltergeist development
  - Poltergeist can now watch and rebuild itself
  - Streamlined development workflow

### Changed
- Silent mode for specific targets in `polter` command
  - Target `peekaboo` executes with suppressed output for clean binary forwarding
  - Maintains standard logging for all other targets

### Fixed
- Poltergeist daemon detection in `polter` command
  - Proper heartbeat checking to verify active daemon status
  - Warning messages for potentially stale binary execution
  - Automatic suppression for `peekaboo` target

## [1.5.1] - 2025-01-03

### Changed
- Replaced Pino with LogTape for zero-dependency logging solution
  - Reduced overall package size
  - Improved logging performance
  - Maintained full API compatibility

### Fixed
- Logger unit tests updated for LogTape compatibility
- Linting issues resolved in logger implementation

## [1.5.0] - 2025-01-02

### Added
- Full Windows 10/11 support with cross-platform compatibility
  - Cross-platform temp directory handling via `os.tmpdir()`
  - Windows-specific process timeout optimizations
  - Comprehensive Windows CI testing pipeline
  - Windows installation documentation
- Homebrew installation method for macOS ARM64 users
  - Official tap: `brew tap steipete/tap && brew install poltergeist`

### Changed
- **Breaking**: Renamed `pgrun` command to `polter`
  - Improved branding and command clarity
  - All documentation updated with new command
- **Breaking**: Unified temp directory usage across platforms
  - CLI and macOS app now use consistent temp directory
  - Environment variable `POLTERGEIST_STATE_DIR` for custom paths
- Enhanced CI pipeline with multi-platform testing matrix

### Fixed
- Cross-platform path separator handling
- Windows drive letter root directory detection
- Process parameter naming conflicts in ProcessManager
- Windows-specific test compatibility issues

## [1.0.0] - 2025-08-03

### Added
- Dedicated CHANGELOG.md file for improved release tracking

### Changed  
- Updated dependencies to latest stable versions
  - winston 3.15.0 → 3.17.0
  - zod 4.0.0 → 4.0.14
  - tsx 4.20.0 → 4.20.3
- Consolidated README documentation with improved organization
- Official stable release marking production readiness

### Fixed
- Complete test suite validation (318 tests passing)
- Full backward compatibility maintained

## [1.0.0-beta.1] - 2025-08-03

### Fixed
- Mac app state file parsing for hyphenated project names
- Staleness threshold consistency (5 minutes across CLI and Mac app)
- CI pipeline test execution order

### Changed
- Replaced custom glob matcher with picomatch library
- Removed legacy status format support
- Improved codebase maintainability (-76 lines)

### Added
- picomatch dependency for robust pattern matching

## [1.0.0-beta.0] - 2025-08-02

### Added
- Initial beta release
- Universal target system for multiple build types
- Smart execution wrapper (polter) for fresh builds
- Intelligent build prioritization and queue management
- Focus pattern detection and configuration
- Native notifications with concurrent build protection
- Advanced state management and process tracking
- Cross-platform support (macOS, Linux, Windows)
- macOS companion app for status bar monitoring