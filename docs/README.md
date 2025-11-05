# Poltergeist Documentation

This directory contains comprehensive documentation for the Poltergeist project, including architecture diagrams and auto-generated API documentation for both TypeScript (CLI) and Swift (macOS app) components.

## 📚 Documentation Structure

```
docs/
├── index.html                      # Main documentation portal
├── architecture.md                 # Architecture diagrams and system overview
├── api/
│   ├── custom.css                  # Shared custom styling for API docs
│   ├── typescript/                 # Auto-generated TypeScript API docs
│   │   ├── index.html             # TypeScript API entry point
│   │   ├── classes/               # Class documentation
│   │   ├── interfaces/            # Interface documentation
│   │   ├── types/                 # Type definitions
│   │   └── modules/               # Module documentation
│   └── swift/                     # Auto-generated Swift API docs
│       ├── index.html             # Swift API entry point
│       └── documentation/         # Swift-DocC generated content
└── README.md                      # This file
```

## 🏗️ Architecture Documentation

The architecture documentation (`architecture.md`) provides:

- **High-level system overview** with Mermaid diagrams
- **Component architecture** for both CLI and macOS app
- **Data flow diagrams** showing communication patterns
- **Configuration and interoperability** details
- **Security considerations** and design principles

Key diagrams include:
- Overall system architecture
- CLI tool internal structure
- macOS app component relationships
- State management and build priority flows

## 📘 Key Guides

- `modern-swift.md` — Modern Swift and SwiftUI practices, now including a Swift 6 adoption checklist that replaces the standalone migration guide.
- `swift-testing-playbook.md` — End-to-end plan for migrating XCTest suites to Swift Testing with WWDC 2024+ patterns.
- `bun.md` — Details on bundling Poltergeist as a single Bun-powered binary and the related release checklist.
- `lockfiles.md` — Deep dive into the lock-free state coordination model used by both the CLI and macOS app.

## 🔧 API Documentation

### TypeScript API (CLI Tool)

Auto-generated from TypeScript source code using TypeDoc:

- **Complete API reference** for all public classes and interfaces
- **Type definitions** with Zod schema validation
- **Configuration interfaces** and builder patterns
- **Usage examples** and JSDoc comments

**Generated from:**
- `src/index.ts` - Main entry point
- `src/types.ts` - Type definitions
- `src/interfaces.ts` - Interface definitions

### Swift API (macOS App)

Auto-generated from Swift source code using Swift-DocC:

- **Native SwiftUI components** documentation
- **Core services** and data models
- **Observable patterns** and actor-based concurrency
- **Platform-specific integrations** (FileWatcher, ProjectMonitor)

**Generated from:**
- All Swift files in `apps/mac/Poltergeist/`
- Includes Features, Models, Services, and Utilities

## 🚀 Building Documentation

### Quick Start

Generate all documentation:
```bash
pnpm run docs:build
```

This runs both TypeScript and Swift documentation generation.

### Individual Components

Generate TypeScript API docs only:
```bash
pnpm run docs:api
```

Generate Swift API docs only:
```bash
pnpm run docs:swift
```

Watch for changes (TypeScript only):
```bash
pnpm run docs:api:watch
```

### Serving Documentation

Start a local server to browse all documentation:
```bash
pnpm run docs:serve
```

Then open `http://localhost:8080` in your browser.

## ⚙️ Configuration

### TypeDoc Configuration

Configuration is in `typedoc.json`:
- **Entry points**: Main files to document
- **Output directory**: `docs/api/typescript`
- **Theme and styling**: Custom CSS and navigation
- **Mermaid support**: For inline diagrams
- **GitHub integration**: Source links and navigation

### Swift-DocC Configuration

Swift documentation is generated using:
- **Xcode's docbuild**: Native Swift-DocC integration
- **Custom script**: `apps/mac/scripts/generate-docs.sh`
- **Archive conversion**: Generates static website from `.doccarchive`

## 📝 Writing Documentation

### TypeScript Documentation

Use JSDoc comments in TypeScript source:

```typescript
/**
 * @category Build System
 * @description Creates a new build request with intelligent prioritization
 * 
 * @param target - The build target configuration
 * @param priority - Priority score (higher = more important)
 * @returns Promise resolving to build result
 * 
 * @example
 * ```typescript
 * const request = await createBuildRequest(target, 5);
 * ```
 */
export async function createBuildRequest(target: Target, priority: number): Promise<BuildRequest> {
  // Implementation
}
```

### Swift Documentation

Use Swift-DocC comments in Swift source:

```swift
/// Represents a Poltergeist-monitored project with its build targets and status.
///
/// A `Project` encapsulates all information about a development project being
/// monitored by Poltergeist, including its build targets, current status, and
/// build history.
///
/// ## Usage Example
///
/// ```swift
/// let project = Project(path: "/path/to/project", name: "MyProject", hash: "abc123")
/// 
/// switch project.overallStatus {
/// case .building:
///     print("Project is currently building")
/// case .success:
///     print("All builds successful")
/// }
/// ```
struct Project: Identifiable, Sendable {
    // Implementation
}
```

## 🎨 Customization

### Styling

Both TypeScript and Swift documentation use custom CSS:
- **TypeScript**: `docs/api/custom.css` (referenced in `typedoc.json`)
- **Swift**: Uses native Swift-DocC theming

### Navigation

The main documentation portal (`docs/index.html`) provides:
- **Unified entry point** for all documentation
- **Status indicators** showing available documentation
- **Feature highlights** and usage information
- **Responsive design** for mobile devices

## 🔄 Maintenance

### Updating Documentation

Documentation should be regenerated when:
- **Source code changes**: New classes, methods, or interfaces
- **Architecture changes**: System design or component relationships
- **Configuration changes**: New options or validation rules

### Automation

Consider setting up:
- **Git hooks**: Auto-generate docs on commit/push
- **CI/CD integration**: Generate docs in build pipeline
- **GitHub Pages**: Host documentation automatically

### Version Management

- Documentation includes version information from `package.json`
- Archive old documentation versions if needed
- Update navigation links when restructuring

## 📊 Features

### Search and Navigation

- **Full-text search** across all API documentation
- **Hierarchical navigation** with collapsible sections
- **Cross-references** between TypeScript and Swift components
- **GitHub integration** with source code links

### Visual Enhancements

- **Mermaid diagrams** in architecture documentation
- **Syntax highlighting** for code examples
- **Dark mode support** (where available)
- **Mobile-responsive** design

### Development Tools

- **Watch mode** for TypeScript documentation
- **Local server** for testing documentation
- **Build validation** to catch documentation errors
- **Custom CSS** for consistent branding

## 🐛 Troubleshooting

### Common Issues

**TypeScript documentation not generating:**
- Check `typedoc.json` configuration
- Ensure all entry points exist
- Verify TypeScript compilation succeeds

**Swift documentation not generating:**
- Ensure Xcode is installed and in PATH
- Check Swift-DocC comments are properly formatted
- Verify project builds successfully

**Mermaid diagrams not rendering:**
- Check `typedoc-plugin-mermaid` is installed
- Verify diagram syntax is correct
- Ensure plugin is listed in `typedoc.json`

### Performance

For large codebases:
- Use `excludeExternals` in TypeDoc config
- Limit entry points to essential files
- Consider splitting documentation by module

## 📖 Contributing

When adding new features:
1. **Add JSDoc/Swift-DocC comments** to new code
2. **Update architecture diagrams** if system design changes
3. **Regenerate documentation** and test locally
4. **Update navigation** if new major components are added

This documentation system ensures that both the TypeScript CLI and Swift macOS components are thoroughly documented with up-to-date API references and architectural insights.
