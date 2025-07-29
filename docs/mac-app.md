# Poltergeist Status Monitor - Mac App Plan

## Overview

A native macOS menu bar application that monitors all active Poltergeist instances across different projects, providing real-time build status and error information through an intuitive SwiftUI interface.

## Core Requirements

- **Technology**: SwiftUI + Swift 6
- **Platform**: macOS 14.0+ (for latest SwiftUI features)
- **UI**: Menu bar app with dropdown status view
- **Communication**: File-based watching of Poltergeist status files
- **Features**:
  - Real-time build status monitoring
  - Error display with details
  - Project grouping
  - App icon extraction
  - Visual status indicators (green/red)

## Architecture

### 1. Core Components

```
PoltergeistMonitor.app/
├── App/
│   ├── PoltergeistMonitorApp.swift      # Main app entry
│   └── AppDelegate.swift                # Menu bar setup
├── Models/
│   ├── PoltergeistInstance.swift        # Single instance model
│   ├── BuildStatus.swift                # Build status data
│   └── ProjectGroup.swift               # Project grouping
├── Services/
│   ├── PoltergeistDetector.swift        # Find active instances
│   ├── StatusFileWatcher.swift          # FSEvents-based watcher
│   └── AppIconExtractor.swift           # Extract app icons
├── Views/
│   ├── MenuBarView.swift                # Main menu bar UI
│   ├── ProjectStatusView.swift          # Project status table
│   └── ErrorDetailView.swift            # Error popover
└── Utils/
    ├── FileSystemUtils.swift            # File operations
    └── StatusIndicator.swift            # Icon generation
```

### 2. Data Model

```swift
// BuildStatus.swift - Matches Poltergeist's TypeScript interface
struct BuildStatus: Codable {
    enum Status: String, Codable {
        case idle, building, success, failed
    }
    
    let status: Status
    let timestamp: String
    let gitHash: String
    let errorSummary: String
    let builder: String
    let buildTime: Double?
}

// PoltergeistInstance.swift
struct PoltergeistInstance: Identifiable {
    let id = UUID()
    let projectPath: String
    let projectName: String
    let configPath: String
    let targets: [BuildTarget]
    var isActive: Bool
    var lastSeen: Date
}

// BuildTarget.swift
struct BuildTarget: Identifiable {
    let id: String // "cli" or "macApp"
    let statusFile: String
    let lockFile: String
    let outputPath: String?
    let bundleId: String?
    var currentStatus: BuildStatus?
    var appIcon: NSImage?
}
```

## Communication Protocol

### 1. Discovery Strategy

**Active Instance Detection**:
1. **Lock File Scanning**: Search for `.poltergeist-*.lock` files in:
   - `/tmp/` (default location)
   - User-specified directories
   - Project roots from recent history

2. **Process Verification**: 
   - Read PID from lock file
   - Verify process is running: `kill(pid, 0)`
   - Check process name contains "node" or "poltergeist"

3. **Config Loading**:
   - Find `.poltergeist.json` in project root
   - Parse to get statusFile paths for each target
   - Validate paths exist

### 2. Status Monitoring

**File Watching Strategy**:
```swift
// Use FSEvents for efficient file monitoring
class StatusFileWatcher {
    private var stream: FSEventStreamRef?
    
    func watchStatusFiles(_ files: [String]) {
        // Create FSEventStream for status file directories
        // Trigger updates on file modifications
        // Debounce rapid changes (100ms)
    }
}
```

**Update Flow**:
1. FSEvents detects status file change
2. Read and parse JSON status
3. Update model with new BuildStatus
4. Trigger UI refresh
5. Show notification if status changed to failed

### 3. Poltergeist Lifecycle Detection

**Instance Gone Detection**:
- Lock file deleted → Mark as inactive
- PID no longer running → Mark as inactive  
- Status file not updated for 30s during "building" → Mark as stale
- Config file deleted → Remove instance

## UI/UX Design

### 1. Menu Bar Icon

**Status Indicators**:
- **All Green**: Ghost icon (normal)
- **Any Red**: Ghost icon with red badge/tint
- **Building**: Animated ghost (subtle pulse)
- **No Active**: Ghost icon (grayed out)

```swift
// Dynamic icon generation
func generateStatusIcon(hasErrors: Bool, isBuilding: Bool) -> NSImage {
    // Base ghost icon (SF Symbol or custom)
    // Apply color tint based on status
    // Add animation if building
}
```

### 2. Menu Structure

```
[Ghost Icon] ← Menu bar icon
├── Project: MyApp
│   ├── ✅ CLI (1.2s)
│   └── ✅ Mac App (3.4s)
├── Project: Framework
│   ├── ❌ CLI - Type error in main.ts:42
│   └── 🔨 Mac App - Building...
├── ─────────────────
├── Open All Logs
├── Preferences...
└── Quit
```

### 3. Project Status View (on click)

**Table Layout**:
| Icon | Target | Status | Build Time | Last Update |
|------|--------|--------|------------|-------------|
| 📱 | MyApp CLI | ✅ Success | 1.2s | 2 min ago |
| 🖥️ | MyApp Mac | ✅ Success | 3.4s | 2 min ago |
| 📱 | Framework CLI | ❌ Failed | - | 5 min ago |

**Error Detail Popover**:
- Click on failed row → Show error details
- Copy error button
- Open in editor button (if possible)

## Technical Implementation

### 1. App Icon Extraction

```swift
class AppIconExtractor {
    func extractIcon(from bundlePath: String) -> NSImage? {
        // 1. Parse Info.plist for CFBundleIconFile
        // 2. Load .icns from Resources
        // 3. Fall back to generic app icon
        let bundle = Bundle(path: bundlePath)
        return bundle?.icon ?? NSWorkspace.shared.icon(forFile: bundlePath)
    }
}
```

### 2. Background Operations

- **FileSystemWatcher**: Runs on background queue
- **Status Updates**: Debounced and coalesced
- **UI Updates**: Always on main queue
- **Notification**: Using UserNotifications framework

### 3. Persistence

**Store in UserDefaults**:
- Recent project paths
- Window positions
- Notification preferences
- Hidden projects list

### 4. Performance Considerations

- **Lazy Loading**: Only watch active status files
- **Caching**: Cache app icons and project metadata
- **Throttling**: Limit file system checks to once per second
- **Memory**: Release inactive project data after 1 hour

## Configuration

### User Preferences

```swift
struct Preferences {
    var showNotifications: Bool = true
    var notifyOnlyOnFailure: Bool = false
    var launchAtLogin: Bool = true
    var statusCheckInterval: TimeInterval = 1.0
    var maxProjectHistory: Int = 20
    var soundEnabled: Bool = true
}
```

## Security & Sandboxing

**Entitlements Required**:
- `com.apple.security.files.user-selected.read-only` - Read status files
- `com.apple.security.temporary-exception.files.absolute-path.read-only` - Access /tmp

**File Access Strategy**:
- Request access to project directories via Open dialog
- Store security-scoped bookmarks for persistent access
- Gracefully handle permission errors

## Installation & Distribution

1. **Direct Download**: Notarized DMG from GitHub releases
2. **Homebrew Cask**: `brew install --cask poltergeist-monitor`
3. **Mac App Store**: Consider for wider distribution

## Future Enhancements

1. **Quick Actions**:
   - Restart build from menu
   - Open project in editor
   - Clear build cache

2. **Rich Notifications**:
   - Show error snippet in notification
   - Action buttons (View, Dismiss, Retry)

3. **Statistics**:
   - Build time trends
   - Success rate tracking
   - Most common errors

4. **Integration**:
   - Xcode Source Editor Extension
   - VS Code status bar integration
   - Terminal status integration

## Development Timeline

1. **Week 1**: Core architecture, models, file watching
2. **Week 2**: Menu bar UI, basic status display
3. **Week 3**: Error handling, notifications, preferences
4. **Week 4**: Polish, testing, distribution setup

## Testing Strategy

- **Unit Tests**: Models, file parsing, status detection
- **UI Tests**: Menu interaction, table views, popovers
- **Integration Tests**: Full flow with mock Poltergeist instances
- **Performance Tests**: Many projects, rapid status changes

## Success Metrics

- Instant status updates (< 100ms from file change)
- Low CPU usage (< 1% idle, < 5% active)
- Low memory footprint (< 50MB with 10 projects)
- Zero crashes in 24-hour monitoring