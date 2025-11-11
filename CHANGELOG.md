# Changelog

All notable changes to Poltergeist will be documented in this file.

## [Unreleased]

- Fixed the daemon skipping post-start builds by feeding an explicit initial-build marker into the intelligent queue, so every enabled target compiles immediately after `poltergeist haunt` and exposes up-to-date `lastBuild` metadata for `poltergeist status`.

## [2.1.0] - 2025-11-08

- `pnpm run poltergeist:haunt` now spawns the daemon, returns immediately, and streams initial builds in the background thanks to early IPC acknowledgement plus detached Node.js launcher pipes (no more hanging shell sessions)
- Added `POLTERGEIST_TEST_MODE` shims across CLI commands and workflows so CI can simulate daemon state without spawning background processes
- macOS companion app artifacts are now packaged directly with `ditto`-generated zip archives, ensuring consistent downloads across releases
- Restored the macOS Swift CI job to automatic runs (with controlled failure handling) so every push and pull request validates the native app toolchain

## [1.8.0] - 2025-08-09

- Target-specific log files in `/tmp/poltergeist/` with plain text format (80% size reduction)
- Separate log file per target matching state file naming: `{projectName}-{hash}-{target}.log`
- Plain text log format for zero parsing overhead: `timestamp level: message`
- Fixed Bun.spawn stdio configuration error - daemon now starts correctly with log file redirection
- Proper file handle wrapping with `Bun.file()` for Bun runtime compatibility
- Improved daemon spawning reliability for Bun standalone binaries
- Polter waits for builds when lock file exists regardless of state (handles any stuck build scenario)
- Detects stuck build processes from error patterns and provides tool-specific recovery commands
- Generic lock detection works with any build system (SwiftPM, Make, Cargo, npm, etc.)

## [1.7.2] - 2025-08-09

- Fixed polter binary not being built during release process - Homebrew users now get working polter command
- Updated build script to build both poltergeist and polter binaries
- Added comprehensive release checklist to prevent future release mistakes

## [1.7.1] - 2025-08-09

- Fixed version string to be compile-time constant - binary no longer reads version from filesystem

## [1.7.0] - 2025-08-09

- Clear differentiation between `polter` and `poltergeist` help messages
- Watchman incremental updates - only changed files detected, not full file lists
- Bun binary compilation - resolved `import.meta.url` issues
- Performance for large projects (e.g., VibeTunnel with 489+ Swift files)
- IPC communication for both Node.js and Bun runtimes
- Startup timeout increased to 60s for complex projects

## [1.6.3] - 2025-08-08

- Real-time build output streaming during execution
- Manual build command with `--verbose` and `--json` options
- Inline error diagnostics with context in build failures
- Automatic rebuild attempts for recent failures when running `polter`
- Enhanced error persistence in state files for quick diagnosis
- Improved error messages with timestamps and actionable next steps
- Better build output capture for error diagnosis
- AI agents now get immediate feedback when builds fail

## [1.6.2] - 2025-08-08

- Fixed `polter` command not executing when installed globally via npm
- Proper detection of execution context for symlinks and global packages
- Fixed silent exit issue when `polter` was invoked globally

## [1.6.1] - 2025-08-07

- `poltergeist polter` subcommand for Homebrew compatibility
- Configurable daemon startup timeout via environment variable
- Automatic retry with exponential backoff for daemon startup
- Default daemon timeout increased from 10s to 30s
- Better error messages when daemon startup fails
- Eliminated code duplication in polter command
- Improved cross-platform path handling

## [1.6.0] - 2025-08-07

- `--verbose` flag for status command with detailed build statistics
- `-v` as version shorthand for all commands
- NPM builder support with automatic package.json detection
- Self-building capability for Poltergeist development
- Executable targets in configuration for `polter` command
- Unified output formatting with consistent prefixes
- Major CLI redesign with modern, consistent format
- CLIFormatter utility for unified help displays
- Commands organized into logical groups
- Fixed daemon detection with proper heartbeat checking
- Binary discovery in subdirectories
- Standardized CLI output and flag conventions

## [2.0.0] - 2025-11-06

- Added hot-reload `polter --watch` flag with restart signal/delay options to keep executables fresh after successful builds
- Introduced config-driven `autoRun` for executable targets so the daemon can relaunch binaries automatically after builds
- Refactored launch handling into shared utilities and added regression tests covering watch mode parsing, launch prep, and the executable runner life cycle
- Auto-detect Go `cmd/<name>/main.go` projects during `poltergeist init --auto`, generating runnable binaries in `dist/bin/`
- Extend the TypeScript example harness to cover the new Go CLI project with tokenized rebuild verification
- Documented hot reload workflows in README, covering daemon setup and multi-target tuning

## [1.9.0] - 2025-11-06

- Replaced the legacy example shell runner with a TypeScript harness that logs structured results to docs/test-e2e-report.json
- Added brace-aware glob expansion so Watchman subscriptions fire reliably across mixed-language targets
- Updated CLI defaults to emit enabled Node targets with separate TypeScript/JavaScript watch paths and aligned tests
- Modernized the CMake builder to use ESM-friendly child_process imports and run library/executable builds without bailing
- Introduced AGENTS.md guidance (symlinked from CLAUDE.md) and removed examples/run-all-examples.sh in favour of the new workflow

## [1.5.1] - 2025-08-03

- Replaced Pino with LogTape for zero-dependency logging
- Updated logger unit tests for LogTape compatibility
- Fixed linting issues in logger implementation

## [1.5.0] - 2025-01-02

- Full Windows 10/11 support with cross-platform compatibility
- Homebrew installation method for macOS ARM64 users
- **Breaking**: Renamed `pgrun` command to `polter` for better branding
- **Breaking**: Unified temp directory usage across platforms with `POLTERGEIST_STATE_DIR` support
- Enhanced CI pipeline with multi-platform testing matrix
- Cross-platform path separator handling
- Windows drive letter root directory detection
- Process parameter naming conflicts in ProcessManager
- Windows-specific test compatibility issues

## [1.0.0] - 2025-08-03

- Dedicated CHANGELOG.md file for improved release tracking
- Updated dependencies: winston 3.17.0, zod 4.0.14, tsx 4.20.3
- Consolidated README documentation with improved organization
- Official stable release marking production readiness
- Complete test suite validation (318 tests passing)

## [1.0.0-beta.1] - 2025-08-03

- Mac app state file parsing for hyphenated project names
- Staleness threshold consistency (5 minutes across CLI and Mac app)
- CI pipeline test execution order
- Replaced custom glob matcher with picomatch library
- Removed legacy status format support
- Improved codebase maintainability (-76 lines)
- picomatch dependency for robust pattern matching

## [1.0.0-beta.0] - 2025-08-02

- Initial beta release
- Universal target system for multiple build types
- Smart execution wrapper (polter) for fresh builds
- Intelligent build prioritization and queue management
- Focus pattern detection and configuration
- Native notifications with concurrent build protection
- Advanced state management and process tracking
- Cross-platform support (macOS, Linux, Windows)
- macOS companion app for status bar monitoring
