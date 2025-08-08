# Changelog

All notable changes to Poltergeist will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.6.3] - 2025-01-15

### Added
- **Real-time build output streaming** - Build output now streams to console in real-time during execution
- **Manual build command** - New `poltergeist build [target]` command for explicit builds with `--verbose` and `--json` options
- **Inline error diagnostics** - Build failures now show actual error messages directly in the output with context
- **Automatic rebuild on failure** - Recent build failures (< 5 minutes) trigger automatic rebuild attempts when running `polter`
- **Enhanced error persistence** - Build errors and output are captured and stored in state files for quick diagnosis

### Changed
- **Improved error messages** - Build failures now show:
  - When the error occurred (e.g., "Failed 2 minutes ago with exit code 1")
  - Last 3 lines of error output directly in the message
  - Actionable next steps (rebuild command, logs command, force option)
- **Better build output capture** - All builds now capture stdout/stderr for error diagnosis, even without explicit log capture
- **Smarter state management** - Added `lastBuildError` field to state files with detailed error context

### Fixed
- AI agents no longer bypass poltergeist when builds fail - they now get immediate, actionable feedback

## [1.6.2] - 2025-01-08

### Fixed
- Fixed `polter` command not executing when installed globally via npm
  - The CLI initialization check was failing for symlinked/global installations
  - Now properly detects execution context for global npm packages, symlinks, and direct invocation
- This fixes the issue where `polter` would exit silently with no output

## [1.6.1] - 2025-01-07

### Added
- `poltergeist polter` subcommand for better Homebrew compatibility - now both `polter` standalone and `poltergeist polter` work correctly
- Configurable daemon startup timeout via `POLTERGEIST_DAEMON_TIMEOUT` environment variable
- Automatic retry logic with exponential backoff for daemon startup (retries at 1s, 2s, 4s intervals)

### Changed
- Increased default daemon startup timeout from 10s to 30s for better support of large projects
- Improved error messages with actionable suggestions when daemon startup fails

### Fixed
- Eliminated code duplication between standalone `polter` and `poltergeist polter` subcommand
- Improved cross-platform path handling for better Windows compatibility

## [1.6.0] - 2025-01-06

### Added
- `--verbose` flag for `poltergeist status` command with detailed build statistics
- `-v` as version shorthand for both `poltergeist` and `polter` commands
- NPM builder support for Node.js projects with automatic package.json detection
- Self-building capability allowing Poltergeist to watch and rebuild itself
- Executable targets in configuration for use with `polter` command

### Changed
- Unified output formatting with consistent `👻 [Poltergeist]` prefix across all commands
- Removed excessive emoji usage for cleaner, professional output
- `polter` command now shows its own help when invoked without arguments instead of defaulting to first target
- **Major CLI redesign**: Implemented modern, consistent CLI output format for both `poltergeist` and `polter` commands
  - Created CLIFormatter utility for unified help displays
  - Organized commands into logical groups (Daemon Control, Project Management, Development)
  - Applied consistent color scheme: cyan headers, yellow sections, gray descriptions
  - Standardized format structure: Header → Usage → Commands/Targets → Options → Examples
  - Improved readability with proper spacing and alignment

### Fixed
- Poltergeist daemon detection in `polter` command with proper heartbeat checking
- Binary discovery in subdirectories when target not found in config
- Standardized CLI output and flag conventions across all commands
- Color display issue where ghost emoji was incorrectly targeted for coloring instead of descriptive text

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