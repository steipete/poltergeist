# Poltergeist macOS App Tests

This directory contains comprehensive Swift Testing tests for the Poltergeist macOS application, following the latest patterns from WWDC 2024 and the Swift Testing playbook.

## 📊 Test Coverage

**Total Test Coverage: 96 test functions across 20 test suites in 7 files**

### Test Structure

```
PoltergeistTests/
├── Models/                      # Model and data structure tests
│   ├── ProjectTests.swift       # Project, TargetState, BuildInfo models
│   └── PreferencesTests.swift   # User preferences and settings
├── Services/                    # Business logic and service tests  
│   ├── ProjectMonitorTests.swift    # Core monitoring service
│   └── NotificationManagerTests.swift # System notifications
├── Features/                    # UI and feature tests
│   └── StatusBarTests.swift     # Menu bar integration
├── Utils/                       # Utility and helper tests
│   └── FileSystemHelpersTests.swift # File system operations  
└── PoltergeistAppTests.swift    # App lifecycle and integration
```

## 🧪 Swift Testing Features Used

This test suite demonstrates comprehensive usage of Swift Testing framework:

### Core Testing Features
- **`@Test`**: 96 individual test functions with descriptive names
- **`@Suite`**: 20 organized test suites with logical grouping
- **`#expect`**: Modern assertions with visual failure diagnostics
- **`#require`**: Safe optional unwrapping and critical preconditions
- **Parameterized Tests**: Data-driven testing with multiple input sets
- **Async Testing**: Full async/await support with confirmations

### Advanced Patterns
- **Tagged Organization**: Tests tagged by category (`.models`, `.services`, `.ui`, etc.)
- **State Isolation**: Fresh instances for each test ensuring no state leakage
- **Error Handling**: Comprehensive error scenario testing with `#expect(throws:)`
- **Performance Testing**: Startup time and memory usage validation
- **Integration Testing**: End-to-end workflow validation

### Test Categories by Tags

| Tag | Purpose | Test Count |
|-----|---------|------------|
| `.models` | Data structures and business logic | ~25 tests |
| `.services` | Core services and monitoring | ~35 tests |
| `.features` | UI components and user interactions | ~15 tests |
| `.utils` | Helper functions and utilities | ~15 tests |
| `.integration` | End-to-end workflows | ~6 tests |
| `.unit` | Isolated unit tests | ~80% of tests |
| `.fast` | Quick-running tests | ~70% of tests |

## 🏗️ Test Architecture

### Model Tests (`Models/`)
- **ProjectTests.swift**: Tests for `Project`, `TargetState`, `BuildInfo`, and build queue models
- **PreferencesTests.swift**: User preferences, `@AppStorage` integration, and ObservableObject behavior

### Service Tests (`Services/`)  
- **ProjectMonitorTests.swift**: Core monitoring logic, state file parsing, and project lifecycle
- **NotificationManagerTests.swift**: System notifications, permission handling, and user preferences

### Feature Tests (`Features/`)
- **StatusBarTests.swift**: Menu bar integration, status icons, and user interactions

### Utility Tests (`Utils/`)
- **FileSystemHelpersTests.swift**: File operations, JSON parsing, and state file validation

### Integration Tests
- **PoltergeistAppTests.swift**: App lifecycle, singleton behavior, and cross-component integration

## 🎯 Key Testing Patterns

### 1. Parameterized Testing
```swift
@Test("Build status determination", arguments: [
    ([], Project.BuildStatus.idle),
    (["success"], Project.BuildStatus.success),
    (["failed"], Project.BuildStatus.failed),
    (["building"], Project.BuildStatus.building)
])
func testOverallStatus(targetStatuses: [String], expectedStatus: Project.BuildStatus) {
    // Test implementation with data-driven inputs
}
```

### 2. Async Testing with Confirmations
```swift
@Test("Property changes trigger objectWillChange")
func testObjectWillChangeNotifications() async throws {
    let changeConfirmation = confirmation("objectWillChange was published", expectedCount: 1)
    
    let cancellable = preferences.objectWillChange.sink {
        Task { @MainActor in
            await changeConfirmation.fulfill()
        }
    }
    
    preferences.showNotifications = false
    
    try await fulfillment(of: [changeConfirmation], timeout: .seconds(1))
}
```

### 3. Error Scenario Testing
```swift
@Test("Process corrupted state file")
func testProcessCorruptedStateFile() throws {
    // Should throw when trying to decode
    #expect(throws: DecodingError.self) {
        try JSONDecoder().decode(PoltergeistState.self, from: data)
    }
}
```

### 4. File System Testing with Isolation
```swift
@Suite("File System Helper Tests", .tags(.utils, .fileSystem))
struct FileSystemHelpersTests {
    let tempDirectory: URL
    
    init() throws {
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("poltergeist-fs-tests")
            .appendingPathComponent(UUID().uuidString)
        
        try FileManager.default.createDirectory(at: tempDirectory, ...)
    }
    
    deinit {
        try? FileManager.default.removeItem(at: tempDirectory)
    }
}
```

## 🚀 Running Tests

### Validation Script
```bash
cd apps/mac
./scripts/test.sh
```

This script validates:
- ✅ All test files have valid Swift syntax  
- ✅ Swift Testing framework usage is correct
- ✅ Test structure follows best practices
- 📊 Provides comprehensive statistics

### Future: Xcode Integration
Once a test target is added to the Xcode project:
```bash
xcodebuild test -project Poltergeist.xcodeproj -scheme PoltergeistTests
```

### CI Integration
Tests are automatically validated in GitHub Actions:
- Syntax validation on every PR
- Swift Testing pattern verification
- Integration with existing macOS CI pipeline

## 📚 Swift Testing Best Practices Demonstrated

1. **Descriptive Test Names**: Every `@Test` has a clear, descriptive name explaining what is being tested

2. **Proper State Management**: Tests use `init()` and `deinit` for setup/teardown instead of legacy XCTest methods

3. **Modern Assertions**: `#expect` and `#require` instead of `XCTAssert` family functions

4. **Tagged Organization**: Logical grouping with tags for easy filtering and reporting

5. **Async/Await Native**: Full integration with Swift's concurrency model

6. **Error Testing**: Comprehensive error scenario coverage with type-safe error validation

7. **Performance Awareness**: Quick-running tests tagged as `.fast` for rapid feedback loops

8. **Integration Testing**: End-to-end scenarios validating complete workflows

## 🎓 Learning Swift Testing

This test suite serves as a comprehensive example of Swift Testing best practices, demonstrating:

- Migration from XCTest patterns to modern Swift Testing
- Advanced testing patterns like parameterization and confirmations
- Proper test organization and architecture
- Real-world testing scenarios for macOS applications
- Integration with CI/CD pipelines

The tests follow the patterns outlined in the [Swift Testing Playbook](https://developer.apple.com/xcode/swift-testing/) and demonstrate production-ready testing practices for Swift 6 and Xcode 16+.