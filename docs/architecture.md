# Poltergeist Architecture

This document provides a comprehensive overview of Poltergeist's architecture, showing how the CLI and macOS components work together to provide seamless file watching and build automation.

## Overview

Poltergeist is a dual-platform application consisting of:
- **CLI Tool** (Node.js/TypeScript) - Core file watching and build engine
- **macOS App** (Swift/SwiftUI) - Native GUI for monitoring and control

Both components communicate through shared state files and configuration, providing a unified experience across command-line and GUI interfaces.

## High-Level Architecture

```mermaid
graph TB
    subgraph "User Interfaces"
        CLI[CLI Tool<br/>Node.js/TypeScript]
        MAC[macOS App<br/>Swift/SwiftUI]
    end
    
    subgraph "Core Services"
        WATCHMAN[Watchman<br/>File Watching Service]
        STATE[State Management<br/>JSON State Files]
        CONFIG[Configuration<br/>poltergeist.config.json]
    end
    
    subgraph "Build System"
        QUEUE[Build Queue<br/>Priority Engine]
        BUILDERS[Builder Factory<br/>Target-specific Builders]
        NOTIFIER[Notification System<br/>macOS Notifications]
    end
    
    subgraph "File System"
        TMPDIR[/tmp/poltergeist/<br/>State Files]
        PROJECT[Project Root<br/>Config & Source Files]
    end
    
    CLI --> WATCHMAN
    CLI --> STATE
    CLI --> CONFIG
    CLI --> QUEUE
    
    MAC --> STATE
    MAC --> CONFIG
    MAC --> NOTIFIER
    
    WATCHMAN --> QUEUE
    QUEUE --> BUILDERS
    BUILDERS --> STATE
    BUILDERS --> NOTIFIER
    
    STATE --> TMPDIR
    CONFIG --> PROJECT
    
    classDef interface fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef service fill:#f3e5f5,stroke:#4a148c,stroke-width:2px  
    classDef storage fill:#e8f5e8,stroke:#1b5e20,stroke-width:2px
    
    class CLI,MAC interface
    class WATCHMAN,QUEUE,BUILDERS,NOTIFIER service
    class STATE,CONFIG,TMPDIR,PROJECT storage
```

## Component Architecture

### CLI Tool (Node.js/TypeScript)

The CLI tool serves as the core engine for file watching and build orchestration:

```mermaid
graph TB
    subgraph "CLI Architecture"
        MAIN[main.ts<br/>Entry Point]
        CLI_CMD[cli.ts<br/>Command Parser]
        POLTER[poltergeist.ts<br/>Core Engine]
        
        subgraph "Core Services"
            WATCHMAN_CLIENT[Watchman Client<br/>File Watching]
            STATE_MGR[State Manager<br/>Process Coordination]
            BUILD_QUEUE[Build Queue<br/>Priority Management]
            PRIORITY_ENGINE[Priority Engine<br/>Smart Scheduling]
        end
        
        subgraph "Builder System"
            FACTORY[Builder Factory<br/>Target Creation]
            EXECUTABLE[Executable Builder<br/>CLI Tools]
            APPBUNDLE[App Bundle Builder<br/>macOS/iOS Apps]
            LIBRARY[Library Builder<br/>Static/Dynamic Libs]
            FRAMEWORK[Framework Builder<br/>Apple Frameworks]
            TEST[Test Builder<br/>Test Suites]
            DOCKER[Docker Builder<br/>Container Images]
            CUSTOM[Custom Builder<br/>User-defined]
        end
        
        subgraph "Utilities"
            CONFIG_MGR[Config Manager<br/>Schema Validation]
            LOGGER[Logger<br/>Structured Logging]
            NOTIFIER[Notifier<br/>System Notifications]
        end
    end
    
    MAIN --> CLI_CMD
    CLI_CMD --> POLTER
    POLTER --> WATCHMAN_CLIENT
    POLTER --> STATE_MGR
    POLTER --> BUILD_QUEUE
    
    BUILD_QUEUE --> PRIORITY_ENGINE
    BUILD_QUEUE --> FACTORY
    
    FACTORY --> EXECUTABLE
    FACTORY --> APPBUNDLE
    FACTORY --> LIBRARY
    FACTORY --> FRAMEWORK
    FACTORY --> TEST
    FACTORY --> DOCKER
    FACTORY --> CUSTOM
    
    POLTER --> CONFIG_MGR
    POLTER --> LOGGER
    POLTER --> NOTIFIER
    
    classDef entry fill:#ffecb3,stroke:#ff8f00,stroke-width:2px
    classDef core fill:#e8eaf6,stroke:#3f51b5,stroke-width:2px
    classDef builder fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef util fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    
    class MAIN,CLI_CMD entry
    class POLTER,WATCHMAN_CLIENT,STATE_MGR,BUILD_QUEUE,PRIORITY_ENGINE core
    class FACTORY,EXECUTABLE,APPBUNDLE,LIBRARY,FRAMEWORK,TEST,DOCKER,CUSTOM builder
    class CONFIG_MGR,LOGGER,NOTIFIER util
```

### macOS App (Swift/SwiftUI)

The macOS app provides a native GUI for monitoring and controlling Poltergeist instances:

```mermaid
graph TB
    subgraph "macOS App Architecture"
        APP[PoltergeistApp.swift<br/>App Entry Point]
        
        subgraph "Features"
            STATUS_BAR[StatusBarController<br/>Menu Bar Integration]
            SETTINGS[SettingsView<br/>Configuration UI]
            MAIN_WINDOW[MainWindow<br/>Project Overview]
        end
        
        subgraph "Models"
            PROJECT[Project.swift<br/>Data Models]
            PREFERENCES[Preferences.swift<br/>User Settings]
        end
        
        subgraph "Services"
            PROJECT_MONITOR[ProjectMonitor<br/>State File Watching]
            FILE_WATCHER[FileWatcher<br/>State Directory Monitor]
            ICON_LOADER[IconLoader<br/>App Icon Management]
            NOTIFICATION_MGR[NotificationManager<br/>System Notifications]
            LAUNCH_AT_LOGIN[LaunchAtLogin<br/>Auto-start Service]
        end
        
        subgraph "Views"
            STATUS_MENU[StatusBarMenuView<br/>Dropdown Menu]
            PROJECT_ROW[ProjectRow<br/>Build Status Display]
            BUILD_QUEUE[BuildQueueView<br/>Active/Queued Builds]
            BUILD_STATS[BuildStatistics<br/>Performance Metrics]
        end
    end
    
    APP --> STATUS_BAR
    APP --> SETTINGS
    APP --> MAIN_WINDOW
    
    STATUS_BAR --> STATUS_MENU
    MAIN_WINDOW --> PROJECT_ROW
    MAIN_WINDOW --> BUILD_QUEUE
    MAIN_WINDOW --> BUILD_STATS
    
    STATUS_BAR --> PROJECT_MONITOR
    STATUS_BAR --> NOTIFICATION_MGR
    
    PROJECT_MONITOR --> FILE_WATCHER
    PROJECT_MONITOR --> ICON_LOADER
    PROJECT_MONITOR --> LAUNCH_AT_LOGIN
    
    PROJECT_MONITOR --> PROJECT
    SETTINGS --> PREFERENCES
    
    classDef app fill:#ffecb3,stroke:#ff8f00,stroke-width:2px
    classDef feature fill:#e8eaf6,stroke:#3f51b5,stroke-width:2px
    classDef model fill:#e0f2f1,stroke:#00695c,stroke-width:2px
    classDef service fill:#fce4ec,stroke:#c2185b,stroke-width:2px
    classDef view fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    
    class APP app
    class STATUS_BAR,SETTINGS,MAIN_WINDOW feature
    class PROJECT,PREFERENCES model
    class PROJECT_MONITOR,FILE_WATCHER,ICON_LOADER,NOTIFICATION_MGR,LAUNCH_AT_LOGIN service
    class STATUS_MENU,PROJECT_ROW,BUILD_QUEUE,BUILD_STATS view
```

## Data Flow and Communication

### State Management Flow

```mermaid
sequenceDiagram
    participant CLI as CLI Tool
    participant WM as Watchman
    participant SF as State Files
    participant MAC as macOS App
    participant USER as User
    
    USER->>CLI: poltergeist haunt
    CLI->>SF: Create initial state
    CLI->>WM: Subscribe to file changes
    
    loop File Watching
        WM->>CLI: File change detected
        CLI->>CLI: Queue build with priority
        CLI->>SF: Update state (building)
        MAC->>SF: Read state changes
        MAC->>USER: Show build status
        CLI->>CLI: Execute build
        CLI->>SF: Update state (success/failure)
        MAC->>SF: Read final state
        MAC->>USER: Show build result
    end
    
    USER->>MAC: Click project in menu
    MAC->>SF: Read detailed state
    MAC->>USER: Show project details
    
    USER->>CLI: Ctrl+C (stop)
    CLI->>SF: Remove state files
    MAC->>SF: Detect removal
    MAC->>USER: Remove from display
```

### Build Priority Flow

```mermaid
graph LR
    subgraph "File Change Detection"
        FILE_CHANGE[File Change<br/>Detected by Watchman]
        CLASSIFY[Classify Change<br/>Direct/Shared/Generated]
        IMPACT[Calculate Impact<br/>Weight and Scope]
    end
    
    subgraph "Priority Calculation"
        FOCUS[Focus Detection<br/>Recent Activity]
        HISTORY[Build History<br/>Success Rate & Time]
        PRIORITY[Priority Score<br/>Algorithm]
    end
    
    subgraph "Build Scheduling"
        QUEUE[Build Queue<br/>Priority Ordered]
        PARALLEL[Parallel Execution<br/>Concurrency Control]
        TIMEOUT[Dynamic Timeout<br/>Based on History]
    end
    
    FILE_CHANGE --> CLASSIFY
    CLASSIFY --> IMPACT
    IMPACT --> FOCUS
    FOCUS --> HISTORY
    HISTORY --> PRIORITY
    PRIORITY --> QUEUE
    QUEUE --> PARALLEL
    PARALLEL --> TIMEOUT
    
    classDef detection fill:#e3f2fd,stroke:#1976d2,stroke-width:2px
    classDef priority fill:#f1f8e9,stroke:#388e3c,stroke-width:2px
    classDef scheduling fill:#fef7ff,stroke:#7b1fa2,stroke-width:2px
    
    class FILE_CHANGE,CLASSIFY,IMPACT detection
    class FOCUS,HISTORY,PRIORITY priority
    class QUEUE,PARALLEL,TIMEOUT scheduling
```

## Configuration and Interoperability

### Configuration Schema

Both CLI and macOS app use the same configuration schema (`poltergeist.config.json`):

```typescript
interface PoltergeistConfig {
  version: '1.0';
  projectType: 'swift' | 'node' | 'rust' | 'python' | 'mixed';
  targets: Target[];
  watchman: WatchmanConfig;
  performance?: PerformanceConfig;
  buildScheduling?: BuildSchedulingConfig;
  notifications?: NotificationConfig;
  logging?: LoggingConfig;
}
```

### State File Format

Communication between CLI and macOS app happens via JSON state files:

```typescript
interface PoltergeistState {
  version: string;
  projectPath: string;
  projectName: string;
  target: string;
  configPath: string;
  process: ProcessInfo;
  lastBuild: BuildStatus;
  appInfo: AppInfo;
}
```

## Key Design Principles

### 1. **Separation of Concerns**
- CLI handles file watching and build execution
- macOS app focuses on monitoring and user interaction
- Clean interfaces through state files and configuration

### 2. **Cross-Platform Compatibility**
- TypeScript CLI runs on any Node.js environment
- macOS app provides native experience
- Shared configuration format ensures consistency

### 3. **Performance Optimization**
- Intelligent build prioritization based on user activity
- Efficient file watching with Watchman
- Concurrent build execution with smart queuing

### 4. **Extensibility**
- Plugin-based builder system
- Configurable target types
- Custom build commands and environments

### 5. **User Experience**
- Real-time build status updates
- Native macOS notifications
- Minimal configuration required

## Security Considerations

### File System Access
- State files stored in `/tmp/poltergeist/` for ephemeral data
- Configuration files remain in project root
- No global system modifications required

### Process Isolation
- Each project instance runs independently
- Heartbeat mechanism prevents zombie processes
- Clean shutdown removes all state files

### macOS Integration
- Sandboxed app bundle (when distributed via App Store)
- Uses standard macOS notification center
- Follows Apple's security guidelines

This architecture ensures Poltergeist provides a robust, performant, and user-friendly development experience across both command-line and graphical interfaces.