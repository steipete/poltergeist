# Contributing to Poltergeist

Thank you for your interest in contributing to Poltergeist! This guide covers both Node.js CLI and macOS app development.

## 🚀 Getting Started

### Prerequisites

- **Node.js 22+** for CLI development
- **Xcode 15+** with Command Line Tools for macOS app development
- **Watchman** installed (`brew install watchman`)
- **SwiftLint** and **swift-format** for Swift code quality (`brew install swiftlint swift-format`)

### Development Setup

```bash
# Clone the repository
git clone https://github.com/steipete/poltergeist.git
cd poltergeist

# Install CLI dependencies
npm install

# Build CLI
npm run build

# Verify setup
npm test
```

For macOS app development:
```bash
# Navigate to macOS app
cd apps/mac

# Open in Xcode
open Poltergeist.xcodeproj

# Or build from command line
xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist build
```

## 📝 Development Guidelines

### Code Style & Quality

We prioritize code quality and proper refactoring over speed. All contributions must meet these standards:

#### Node.js/TypeScript Standards
- **Type Safety First**: Use proper TypeScript types, never `any` or workarounds
- **Modern JavaScript**: ES2022+ features, async/await over promises
- **Functional Style**: Prefer immutable operations and pure functions
- **Error Handling**: Comprehensive error handling with proper typing

#### Swift Standards  
- **Swift 6**: Strict concurrency checking enabled
- **Modern Swift**: Use latest language features and best practices
- **Memory Safety**: Proper `@MainActor` usage and concurrency annotations
- **Architecture**: Clean separation of concerns with proper abstractions

### Code Quality Checks

Before submitting any PR, ensure all quality checks pass:

#### CLI/Node.js Checks
```bash
npm run build           # TypeScript compilation
npm test               # Test suite
npm run lint           # Biome linting
npm run typecheck      # Type validation
npm run format:check   # Code formatting
```

#### macOS App Checks
```bash
cd apps/mac
./scripts/lint.sh      # SwiftLint validation
./scripts/format.sh    # swift-format fixes
xcodebuild -project Poltergeist.xcodeproj -scheme Poltergeist build
```

### No Quick Fixes Policy

We follow a **"No Quick Fixes"** policy:
- ❌ No ignoring of linting errors or warnings
- ❌ No `@ts-ignore` or similar workarounds
- ❌ No `// swiftlint:disable` unless absolutely necessary
- ❌ No band-aid solutions that don't address root causes
- ✅ Proper refactoring and type-safe solutions
- ✅ Clean code that removes unused imports and dead code
- ✅ Quality over speed in implementation

## 🏗️ Architecture Overview

### CLI Architecture (Node.js/TypeScript)

```
src/
├── cli.ts              # Command line interface entry point
├── builders/           # Target-specific build implementations
│   ├── base-builder.ts # Abstract base class for all builders
│   ├── executable-builder.ts
│   ├── app-bundle-builder.ts
│   └── index.ts
├── utils/              # Utility modules
│   ├── filesystem.ts   # File system operations
│   ├── process-manager.ts
│   └── config-manager.ts
├── poltergeist.ts      # Core application logic
├── state.ts            # State management system
├── build-queue.ts      # Smart build queue management
├── priority-engine.ts  # Intelligent priority scoring
└── watchman.ts         # Watchman file watching integration
```

Key principles:
- **Builder Pattern**: Each target type has a dedicated builder
- **State Management**: Unified state system with atomic operations
- **Queue Management**: Intelligent build scheduling and deduplication
- **Watchman Integration**: Efficient file watching with smart exclusions

### macOS App Architecture (Swift)

```
Poltergeist/
├── PoltergeistApp.swift       # App entry point
├── Models/                    # Data models
│   ├── Project.swift         # Project and target state models
│   └── Preferences.swift     # User preferences
├── Services/                  # Business logic services
│   ├── ProjectMonitor.swift  # Core monitoring service
│   ├── NotificationManager.swift
│   ├── FileWatcher.swift
│   └── IconLoader.swift
├── Features/                  # UI components
│   ├── StatusBarController.swift
│   ├── StatusBarMenuView.swift
│   └── SettingsView.swift
└── Utils/                     # Utility extensions
    ├── NSMenuItem+Extensions.swift
    └── VisualEffectView.swift
```

Key principles:
- **MVVM Architecture**: Clear separation of UI and business logic
- **SwiftUI + AppKit**: Modern UI with legacy integration where needed
- **Actor-based Concurrency**: Proper `@MainActor` usage for UI updates
- **Service-Oriented**: Core functionality in dedicated service classes

## 🔄 Development Workflow

### 1. Branch Strategy
- **main**: Production-ready code only
- **feature/**: New features (`feature/smart-notifications`)
- **fix/**: Bug fixes (`fix/build-queue-deadlock`)
- **refactor/**: Code improvements (`refactor/state-management`)

### 2. Commit Message Format
```
type: Brief description (50 chars max)

Detailed explanation of what and why, not how.
Reference issues: Fixes #123, Closes #456

Breaking changes should be clearly noted.
```

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `ci`, `chore`

### 3. Pull Request Process

1. **Create Feature Branch**
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make Changes**
   - Follow code style guidelines
   - Add/update tests for new functionality
   - Update documentation as needed

3. **Quality Checks**
   ```bash
   # CLI checks
   npm run build && npm test && npm run lint && npm run typecheck
   
   # macOS app checks (if applicable)
   cd apps/mac && ./scripts/lint.sh && ./scripts/format.sh
   ```

4. **Commit and Push**
   ```bash
   git add .
   git commit -m "feat: Add intelligent build prioritization"
   git push origin feature/your-feature-name
   ```

5. **Create Pull Request**
   - Clear title and description
   - Reference related issues
   - Include testing instructions
   - Screenshots for UI changes

## 🧪 Testing Guidelines

### CLI Testing
- **Unit Tests**: Test individual functions and classes
- **Integration Tests**: Test component interactions
- **E2E Tests**: Test complete workflows
- **Performance Tests**: Ensure scalability

```bash
# Run specific test files
npm test -- priority-engine.test.ts

# Run with coverage
npm test -- --coverage

# Watch mode for development
npm test -- --watch
```

### macOS App Testing
- **Unit Tests**: Test business logic and models
- **UI Tests**: Test user interface interactions
- **Integration Tests**: Test CLI/app communication

```bash
cd apps/mac
xcodebuild test -project Poltergeist.xcodeproj -scheme Poltergeist
```

### Test Requirements
- **New Features**: Must include comprehensive tests
- **Bug Fixes**: Must include regression tests
- **Coverage**: Maintain >80% test coverage
- **Performance**: No degradation in existing benchmarks

## 📚 Documentation Standards

### Code Documentation
- **TypeScript**: JSDoc comments for public APIs
- **Swift**: Swift documentation comments for public interfaces
- **README Updates**: Keep installation and usage instructions current
- **Changelog**: Document all user-facing changes

### Documentation Requirements
- **New Features**: Update README with usage examples
- **API Changes**: Update API documentation
- **Configuration**: Document new config options
- **Breaking Changes**: Migration guides required

## 🔍 Debugging & Troubleshooting

### CLI Debugging
```bash
# Enable debug logging
POLTERGEIST_LOG_LEVEL=debug poltergeist haunt

# Verbose output
poltergeist haunt --verbose

# Check state files
ls -la /tmp/poltergeist/
cat /tmp/poltergeist/your-project-hash-target.state
```

### macOS App Debugging
```bash
# Console logs
log stream --predicate 'subsystem BEGINSWITH "com.poltergeist"'

# Xcode debugging
# Set breakpoints and use Xcode's debugger
# Enable scheme debugging options for detailed output
```

### Common Issues & Solutions

#### CLI Issues
- **Watchman not found**: Install with `brew install watchman`
- **Permission errors**: Check file permissions in `/tmp/poltergeist/`
- **Build hangs**: Check for circular dependencies in build commands
- **State corruption**: Clean state with `poltergeist clean`

#### macOS App Issues
- **SwiftLint failures**: Run `./scripts/lint.sh` to see specific violations
- **Build errors**: Ensure Xcode Command Line Tools are installed
- **Concurrency warnings**: Review `@MainActor` usage and async patterns

## 🚀 CI/CD Integration

Our CI/CD pipeline automatically validates all contributions:

### Automated Checks
- **Multi-platform testing**: Node.js 22/24 on Ubuntu and macOS
- **Swift 6 compilation**: Strict concurrency and type checking
- **Code quality**: SwiftLint, swift-format, Biome, TypeScript validation
- **Test coverage**: Comprehensive coverage reporting
- **Security scanning**: Dependency vulnerability checks

### Release Process
- **Automated releases**: Tagged releases trigger dual-platform builds
- **CLI packaging**: npm package with proper semver
- **macOS app distribution**: Signed DMG and ZIP artifacts
- **Release notes**: Auto-generated from commit history

## 💡 Contribution Ideas

### CLI Enhancements
- **New Build Targets**: Support for additional languages/frameworks
- **Performance Optimizations**: Faster file watching and build detection
- **Configuration Improvements**: Enhanced project detection and setup
- **Integration Features**: IDE plugins, shell completions

### macOS App Features
- **Enhanced UI**: Better build progress visualization
- **System Integration**: Touch Bar support, widgets
- **Notification Improvements**: Rich notifications with actions
- **Performance Monitoring**: Build analytics and insights

### Cross-Platform Features
- **State Synchronization**: Better CLI/app integration
- **Remote Monitoring**: Network-based project monitoring
- **Plugin System**: Extensible architecture for custom builders
- **Configuration Management**: Shared configuration between CLI and app

## 📧 Getting Help

- **Issues**: [GitHub Issues](https://github.com/steipete/poltergeist/issues) for bugs and feature requests
- **Discussions**: [GitHub Discussions](https://github.com/steipete/poltergeist/discussions) for questions and ideas
- **Code Review**: All PRs receive thorough review and feedback

## 🏆 Recognition

Contributors are recognized in:
- **Changelog**: All contributions documented
- **README**: Major contributors listed
- **Release Notes**: Contribution highlights in releases

---

Thank you for contributing to Poltergeist! Your efforts help make development workflows more efficient for developers worldwide. 🚀
