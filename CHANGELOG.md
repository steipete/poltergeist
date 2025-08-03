# Changelog

All notable changes to Poltergeist will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0-beta.1] - 2025-08-03

### 🚨 Critical Fixes

#### Fixed
- **Mac app state file parsing for projects with hyphens**: Previously, the macOS companion app would fail to correctly identify projects or targets with hyphens in their names (e.g., `my-project`, `my-target`). Now uses robust regex parsing to correctly extract the 8-character hash regardless of hyphen usage.
- **Staleness threshold consistency**: Eliminated confusing behavior where the Mac app would show projects as "stale" (30 seconds) while the CLI considered them active (5 minutes). Both now use a consistent 5-minute threshold.
- **CI pipeline test execution order**: Fixed `dist/pgrun.js` missing module errors by ensuring builds complete before tests run.

### 🔧 Code Quality Improvements

#### Changed
- **Replaced custom glob matcher with picomatch**: Removed 70+ lines of custom pattern matching code and replaced it with the battle-tested [picomatch](https://github.com/micromatch/picomatch) library for more reliable and feature-complete glob matching.
- **Removed legacy status format support**: Cleaned up backward compatibility code for legacy `'failed'` vs `'failure'` status formats, simplifying the codebase.

#### Added
- **picomatch dependency**: Added `picomatch` and `@types/picomatch` for robust glob pattern matching.

### 📊 Impact
- ✅ All 318 tests passing
- ✅ Critical production bugs eliminated  
- ✅ Improved code maintainability (-76 net lines of code)
- ✅ Better user experience consistency between CLI and Mac app

### 🙏 Acknowledgment
These improvements were identified through a comprehensive AI-powered code review that analyzed the entire codebase for bugs, inefficiencies, and improvement opportunities.

---

## [1.0.0-beta.0] - 2025-08-02

### Added
- Initial beta release of Poltergeist
- Universal target system for executables, app bundles, libraries, frameworks, tests, Docker containers
- Smart execution wrapper (`pgrun`) ensures fresh builds
- Intelligent build prioritization and queue management
- Focus pattern detection and smart configuration
- Native notifications and concurrent build protection
- Advanced state management with process tracking
- Cross-platform support (macOS, Linux, Windows)
- macOS companion app for status bar monitoring