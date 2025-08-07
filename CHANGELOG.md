# Changelog

All notable changes to Poltergeist will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.0] - 2025-01-06

### Added
- `--verbose` flag for `poltergeist status` command with detailed build statistics
- `-v` as version shorthand for both `poltergeist` and `polter` commands
- NPM builder support for Node.js projects with automatic package.json detection
- Self-building capability allowing Poltergeist to watch and rebuild itself

### Changed
- Unified output formatting with consistent `👻 [Poltergeist]` prefix across all commands
- Removed excessive emoji usage for cleaner, professional output

### Fixed
- Poltergeist daemon detection in `polter` command with proper heartbeat checking
- Binary discovery in subdirectories when target not found in config

## [1.5.1] - 2025-01-03

### Changed
- Replaced Pino with LogTape for zero-dependency logging solution

### Fixed
- Logger unit tests updated for LogTape compatibility
- Linting issues resolved in logger implementation

## [1.5.0] - 2025-01-02

### Added
- Full Windows 10/11 support with cross-platform compatibility
- Homebrew installation method for macOS ARM64 users

### Changed
- **Breaking**: Renamed `pgrun` command to `polter` for better branding
- **Breaking**: Unified temp directory usage across platforms with `POLTERGEIST_STATE_DIR` support
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
- Updated dependencies: winston 3.17.0, zod 4.0.14, tsx 4.20.3
- Consolidated README documentation with improved organization
- Official stable release marking production readiness

### Fixed
- Complete test suite validation (318 tests passing)

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