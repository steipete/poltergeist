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

## Project Structure

### 1. Repository Layout

```
poltergeist/                          # Main Poltergeist repo
├── src/                              # TypeScript source
├── package.json                      # Node.js config
├── .poltergeist.json                 # Example config
├── README.md
├── docs/
│   └── mac-app.md                    # This file
└── apps/                             # Native apps folder
    └── PoltergeistMonitor/           # Mac app project
        ├── PoltergeistMonitor.xcodeproj
        ├── PoltergeistMonitor/
        │   ├── App/
        │   │   ├── PoltergeistMonitorApp.swift
        │   │   └── AppDelegate.swift
        │   ├── Models/
        │   │   ├── PoltergeistState.swift
        │   │   └── BuildStatus.swift
        │   ├── Services/
        │   │   ├── StateFileWatcher.swift
        │   │   └── IconLoader.swift
        │   ├── Views/
        │   │   ├── MenuBarView.swift
        │   │   └── ProjectStatusView.swift
        │   ├── Resources/
        │   │   ├── Assets.xcassets
        │   │   └── Info.plist
        │   └── Utils/
        │       └── FileSystemUtils.swift
        └── README.md

```

### 2. Why `apps/` folder?

- **Monorepo structure**: Keeps native apps with the main project
- **Shared documentation**: Easy cross-referencing
- **Version sync**: Release Mac app alongside Poltergeist updates
- **Clear separation**: TypeScript vs Swift code
- **Future expansion**: Room for Windows/Linux monitors

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

### 1. Improved Directory Structure

**Dedicated Poltergeist Directory**:
```
/tmp/poltergeist/
├── my-app-a3f2c891-cli.lock
├── my-app-a3f2c891-cli.status
├── my-app-a3f2c891-macApp.lock
├── my-app-a3f2c891-macApp.status
├── framework-b7d4e2f3-cli.lock
├── framework-b7d4e2f3-cli.status
└── ...
```

**File Naming Pattern**:
- Format: `{folderName}-{projectHash}-{target}.{extension}`
- Example: `my-app-a3f2c891-cli.status`
- Components:
  - `folderName`: Last component of project path (human-readable)
  - `projectHash`: First 8 chars of SHA-256 hash (uniqueness)
  - `target`: Build target (cli/macApp)
  - `extension`: .lock or .status

**Benefits**:
- Human-readable at a glance
- Guaranteed unique via hash
- Easy to identify projects
- Single directory to watch

### 2. Consolidated Log File Format

**Single JSON file per target containing all info**:
```json
{
  "version": "1.0",
  "pid": 12345,
  "projectPath": "/Users/steipete/Projects/my-app",
  "projectName": "my-app",
  "target": "cli",
  "configPath": "/Users/steipete/Projects/my-app/.poltergeist.json",
  "startTime": "2024-01-20T10:30:00Z",
  "lastHeartbeat": "2024-01-20T10:35:00Z",
  "buildStatus": {
    "status": "failed",
    "timestamp": "2024-01-20T10:34:55Z",
    "gitHash": "abc123",
    "errorSummary": "Type error in main.ts:42",
    "builder": "TypeScript",
    "buildTime": 1.234,
    "fullError": "src/main.ts:42:5 - error TS2322: Type 'string' is not assignable to type 'number'."
  },
  "appInfo": {
    "bundleId": "com.example.myapp",
    "outputPath": "/path/to/MyApp.app",
    "icon": "base64_encoded_icon_data_optional"
  }
}
```

### 3. Discovery & Monitoring Flow

**Mac App Workflow**:
1. **Watch single directory**: FSEvents on `/tmp/poltergeist/`
2. **Parse any `.log` file**: Extract all needed info from one place
3. **Verify process**: Check PID is still alive
4. **Monitor heartbeat**: Mark stale if not updated in 30s

### 4. Efficient File Watching

**Single Directory Watch**:
```swift
class PoltergeistWatcher {
    private var stream: FSEventStreamRef?
    
    func startWatching() {
        let pathToWatch = "/tmp/poltergeist/"
        
        // Create directory if needed
        try? FileManager.default.createDirectory(
            atPath: pathToWatch,
            withIntermediateDirectories: true
        )
        
        // Watch single directory - much more efficient!
        stream = FSEventStreamCreate(
            nil,
            fsEventsCallback,
            nil,
            [pathToWatch] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.1, // 100ms latency
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents)
        )
    }
}
```

### 5. Lifecycle Management

**Single State File Approach**:
```
/tmp/poltergeist/
├── my-app-a3f2c891-cli.state
├── my-app-a3f2c891-macApp.state
├── framework-b7d4e2f3-cli.state
└── ...
```

**Single State File (combines everything)**:
```json
{
  "version": "1.0",
  "projectPath": "/Users/steipete/Projects/my-app",
  "projectName": "my-app",
  "target": "cli",
  "configPath": "/Users/steipete/Projects/my-app/.poltergeist.json",
  
  "process": {
    "pid": 12345,
    "isActive": true,
    "startTime": "2024-01-20T10:30:00Z",
    "lastHeartbeat": "2024-01-20T10:35:00Z"
  },
  
  "lastBuild": {
    "status": "failed",
    "timestamp": "2024-01-20T10:34:55Z",
    "gitHash": "abc123",
    "errorSummary": "Type error in main.ts:42",
    "buildTime": 1.234,
    "fullError": "src/main.ts:42:5 - error TS2322..."
  },
  
  "appInfo": {
    "bundleId": "com.example.myapp",
    "outputPath": "/path/to/MyApp.app",
    "iconPath": "/Users/steipete/Projects/my-app/Assets/AppIcon.png"
  }
}
```

**Icon Configuration in .poltergeist.json**:
```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "swift build",
    "iconPath": "Assets/CLIIcon.png",
    // ... other config
  },
  "macApp": {
    "enabled": true,
    "buildCommand": "xcodebuild ...",
    "iconPath": "MyApp/Assets.xcassets/AppIcon.appiconset/icon_128x128.png",
    // ... other config
  }
}
```

**How Poltergeist Runs**:
- **NOT a daemon** - runs as foreground process in terminal
- **Uses Watchman** - Facebook's file watching daemon
- **Started with**: `poltergeist haunt` (blocks terminal)
- **Stopped with**: Ctrl+C or closing terminal

**Lifecycle Detection**:
1. **Active**: PID exists and process is alive
2. **Inactive**: PID missing or process dead
3. **Stale**: Heartbeat older than 30 seconds

**Benefits of Single File**:
- Atomic updates (write to temp, rename)
- Single source of truth
- Easy to parse and understand
- No sync issues between files

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
├── Clean Up Inactive Projects
├── Preferences...
└── Quit
```

**Right-Click Context Menu**:
```
Right-click on any project entry:
├── View Full Error
├── Copy Error Message
├── Open Project Folder
├── ─────────────────
└── Remove from Monitor
```

### 3. Project Status View (on click)

**Table Layout**:
| Icon | Target | Status | Build Time | Last Update | Active |
|------|--------|--------|------------|-------------|---------|
| 📱 | MyApp CLI | ✅ Success | 1.2s | 2 min ago | 🟢 |
| 🖥️ | MyApp Mac | ✅ Success | 3.4s | 2 min ago | 🟢 |
| 📱 | Framework CLI | ❌ Failed | - | 5 min ago | ⚪ |

**Visual Indicators**:
- 🟢 Active (Poltergeist running)
- ⚪ Inactive (Poltergeist stopped)
- Dimmed rows for inactive projects

**Error Detail Popover**:
- Click on failed row → Show error details
- Copy error button
- Open in editor button (if possible)

## Technical Implementation

### 1. App Icon Loading

```swift
class IconLoader {
    func loadIcon(from state: PoltergeistState) -> NSImage? {
        // 1. First try the configured icon path
        if let iconPath = state.appInfo.iconPath {
            let fullPath = URL(fileURLWithPath: state.projectPath)
                .appendingPathComponent(iconPath)
            if let image = NSImage(contentsOf: fullPath) {
                return image
            }
        }
        
        // 2. For Mac apps, try extracting from built app
        if state.target == "macApp", 
           let outputPath = state.appInfo.outputPath,
           let bundle = Bundle(path: outputPath) {
            return bundle.icon
        }
        
        // 3. Fall back to generic icon based on target type
        return state.target == "cli" ? terminalIcon : appIcon
    }
}
```

**Benefits of Icon Configuration**:
- Projects can specify custom icons
- Works for both CLI tools and Mac apps
- Relative paths keep configs portable
- Falls back gracefully if icon missing

### 2. Cleanup Features

```swift
class StateFileManager {
    func removeProject(_ stateFile: String) {
        // Delete the state file
        let url = URL(fileURLWithPath: "/tmp/poltergeist/\(stateFile)")
        try? FileManager.default.removeItem(at: url)
    }
    
    func cleanupInactiveProjects() {
        // Remove all state files where isActive = false
        let files = try? FileManager.default.contentsOfDirectory(
            atPath: "/tmp/poltergeist"
        )
        
        for file in files ?? [] {
            if let data = try? Data(contentsOf: URL(fileURLWithPath: "/tmp/poltergeist/\(file)")),
               let state = try? JSONDecoder().decode(PoltergeistState.self, from: data),
               !state.process.isActive {
                removeProject(file)
            }
        }
    }
}
```

**User Actions**:
- **Right-click → Remove**: Deletes state file immediately
- **Clean Up Inactive**: Bulk removes all stopped projects
- **Automatic cleanup**: Option to auto-remove after X days

### 3. Background Operations

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

### Build Instructions

```bash
# From the repository root
cd apps/PoltergeistMonitor

# Build for release
xcodebuild -project PoltergeistMonitor.xcodeproj \
  -scheme PoltergeistMonitor \
  -configuration Release \
  -archivePath ./build/PoltergeistMonitor.xcarchive \
  archive

# Export for distribution
xcodebuild -exportArchive \
  -archivePath ./build/PoltergeistMonitor.xcarchive \
  -exportPath ./build \
  -exportOptionsPlist ExportOptions.plist
```

## Current Limitations & Recommendations

### Lock File Collision Issue

**Problem**: Current Poltergeist implementation uses user-configured lock file paths that can collide between projects.

**Recommended Solution for Poltergeist**:
```javascript
// Generate unique lock file based on project path hash
const crypto = require('crypto');
const projectHash = crypto.createHash('sha256')
  .update(projectRoot)
  .digest('hex')
  .substring(0, 8);

const lockFile = `/tmp/poltergeist-${projectHash}-${target}.lock`;
// Example: /tmp/poltergeist-a3f2c891-cli.lock
```

**Benefits**:
- Guaranteed unique per project path
- Short enough to be readable (8 chars)
- Deterministic (same project = same hash)
- No conflicts between projects

**Mac App Adaptation**:
Until Poltergeist implements this, the Mac app should:
1. Read lock file contents to extract project path
2. Store project path inside lock files
3. Handle conflicts by validating PID + project path combination

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