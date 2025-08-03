# Changelog

All notable changes to Poltergeist will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-08-03

### Added
- Dedicated changelog moved from README for better maintainability

### Changed  
- Updated dependencies: winston 3.15.0 → 3.17.0, zod 4.0.0 → 4.0.14, tsx 4.20.0 → 4.20.3
- Consolidated README documentation with collapsible sections for improved readability
- Official stable release - graduated from beta to production-ready 1.0.0

### Fixed
- All 318 tests passing with full backward compatibility maintained

---

## [1.0.0-beta.1] - 2025-08-03

### Fixed
- Mac app state file parsing for projects with hyphens in names using robust regex-based hash extraction
- Staleness threshold consistency between CLI (5 minutes) and Mac app (previously 30 seconds)  
- CI pipeline test execution order to prevent missing module errors

### Changed
- Replaced custom glob matcher (70+ lines) with battle-tested picomatch library
- Removed legacy status format support for cleaner codebase
- Improved code maintainability with net reduction of 76 lines

### Added
- picomatch dependency for robust glob pattern matching
- Comprehensive documentation of build system improvements

---

## [1.0.0-beta.0] - 2025-08-02

### Added
- Initial beta release
- Universal target system supporting executables, app bundles, libraries, frameworks, tests, Docker containers
- Smart execution wrapper (pgrun) ensuring fresh builds
- Intelligent build prioritization and queue management
- Focus pattern detection and smart configuration
- Native notifications with concurrent build protection
- Advanced state management with process tracking
- Cross-platform support (macOS, Linux, Windows)
- macOS companion app for status bar monitoring