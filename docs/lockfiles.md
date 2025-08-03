# Lock-Free State Management in Poltergeist

Poltergeist implements a sophisticated lock-free synchronization mechanism that allows multiple processes to safely coordinate builds without traditional lock files. This document explains the design, implementation, and benefits of this approach.

## Overview

Instead of using separate lock files, Poltergeist employs a unified state file system where each build target maintains a single JSON state file containing all necessary information for coordination. This approach eliminates common issues with stale lock files while providing robust process coordination.

## State File Structure

State files are stored in `/tmp/poltergeist/` with a predictable naming convention:

```
{projectName}-{projectHash}-{targetName}.state
```

Where:
- `projectName`: The name of the project (last directory component)
- `projectHash`: First 8 characters of SHA256(projectPath)
- `targetName`: The name of the specific build target

Example: `myapp-a1b2c3d4-frontend.state`

### State File Contents

Each state file contains:

```json
{
  "version": "1.0",
  "projectPath": "/Users/example/projects/myapp",
  "projectName": "myapp",
  "target": "frontend",
  "targetType": "executable",
  "configPath": "/Users/example/projects/myapp/.poltergeist.json",
  
  "process": {
    "pid": 12345,
    "hostname": "MacBook-Pro.local",
    "isActive": true,
    "startTime": "2024-01-15T10:30:00.000Z",
    "lastHeartbeat": "2024-01-15T10:35:45.000Z"
  },
  
  "lastBuild": {
    "status": "success",
    "timestamp": "2024-01-15T10:35:30.000Z",
    "gitHash": "abc123",
    "buildTime": 2.543,
    "errorSummary": null
  },
  
  "appInfo": {
    "bundleId": "com.example.app",
    "outputPath": "./dist/app",
    "iconPath": "./assets/icon.png"
  }
}
```

## Lock Detection Algorithm

The `isLocked()` method in `src/state.ts` implements the following algorithm:

```typescript
function isLocked(targetName: string): boolean {
  1. Read the state file for the target
  2. If no state file exists → not locked
  3. If the PID matches current process → not locked (it's us)
  4. Check if the process is still alive using process.kill(pid, 0)
  5. If process is dead → not locked
  6. Check heartbeat timestamp
  7. If heartbeat is older than 5 minutes → not locked (stale)
  8. Otherwise → locked by another active process
}
```

## Atomic File Operations

All state file writes are atomic to prevent corruption:

```typescript
// src/state.ts:154-187
private async writeState(targetName: string): Promise<void> {
  const stateFile = this.getStateFilePath(targetName);
  const tempFile = `${stateFile}.tmp`;
  
  // Write to temporary file
  writeFileSync(tempFile, JSON.stringify(state, null, 2));
  
  // Atomic rename
  renameSync(tempFile, stateFile);
}
```

This ensures that readers never see partial writes or corrupted data.

## Heartbeat Mechanism

Active processes update their heartbeat every 10 seconds:

```typescript
// src/state.ts:251-259
public startHeartbeat(): void {
  this.heartbeatInterval = setInterval(async () => {
    for (const targetName of this.states.keys()) {
      await this.writeState(targetName);
    }
  }, 10000); // Update every 10 seconds
}
```

The heartbeat serves two purposes:
1. Indicates the process is still alive and working
2. Updates the `lastHeartbeat` timestamp for staleness detection

## Process Lifecycle

### Startup
1. Create initial state file with current process info
2. Start heartbeat timer
3. Begin monitoring and building

### During Operation
1. Update heartbeat every 10 seconds
2. Update build status after each build
3. Check for locks before starting new builds

### Shutdown
1. Stop heartbeat timer
2. Set `isActive: false` in state
3. Write final state update

## Mac App Integration

The macOS companion app (`apps/mac/Poltergeist`) monitors the same state files:

### Read-Only Access
The Mac app only reads state files, never writes:

```swift
// ProjectMonitor.swift:70-127
for file in files where file.hasSuffix(".state") {
    if let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)),
       let state = try? JSONDecoder().decode(PoltergeistState.self, from: data) {
        // Process state data...
    }
}
```

### File System Events
The Mac app uses FSEvents to detect state file changes:

```swift
// ProjectMonitor.swift:52-59
private func setupFileWatcher() {
    fileWatcher = FileWatcher(path: poltergeistDirectory) { [weak self] in
        Task { @MainActor in
            self?.scanForProjects()
        }
    }
    fileWatcher?.start()
}
```

### Staleness Detection
The Mac app uses the same 5-minute staleness threshold as the CLI for consistency:

```swift
// ProjectMonitor.swift
private func isProcessStale(heartbeat: Date?) -> Bool {
    guard let heartbeat = heartbeat else { return true }
    // Use same staleness threshold as CLI (5 minutes = 300 seconds)
    return Date().timeIntervalSince(heartbeat) > 300
}
```

## Benefits of This Approach

### 1. No Orphaned Lock Files
Traditional lock files can be left behind if a process crashes. With unified state files:
- Heartbeat mechanism detects dead processes
- Staleness timeout ensures eventual cleanup
- No separate lock files to manage

### 2. Rich Process Information
State files contain more than just lock status:
- Build history and status
- Process identification (PID, hostname)
- Application metadata
- Timing information

### 3. Atomic Operations
All updates are atomic:
- No race conditions during writes
- Readers always see consistent data
- Failed writes don't corrupt existing state

### 4. Multi-Tool Coordination
The same state files serve multiple purposes:
- CLI uses them for lock detection
- Mac app uses them for status display
- Future tools can integrate easily

### 5. Automatic Recovery
Stale lock detection is built-in:
- 5-minute timeout for CLI operations
- No manual intervention needed
- Graceful handling of crashed processes

## Edge Cases and Error Handling

### Missing State Directory
The state directory is created automatically:

```typescript
// src/state.ts:54-57
if (!existsSync(this.stateDir)) {
  mkdirSync(this.stateDir, { recursive: true });
}
```

### Corrupted State Files
Invalid JSON is handled gracefully:

```typescript
// src/state.ts:215-218
} catch (error) {
  this.logger.error(`Failed to read state for ${targetName}: ${error}`);
  return null;
}
```

### Clock Skew
The system uses relative time comparisons:
- Heartbeat age is calculated as `now - lastHeartbeat`
- Works correctly even with minor clock differences
- Major clock skew (>5 minutes) may cause false positives

### File System Permissions
Write failures are logged but don't crash:

```typescript
// src/state.ts:176-185
} catch (error) {
  this.logger.error(`Failed to write state for ${targetName}: ${error}`);
  // Clean up temp file if it exists
  try {
    if (existsSync(tempFile)) {
      unlinkSync(tempFile);
    }
  } catch {}
}
```

## Best Practices

### For CLI Development
1. Always use atomic file operations
2. Update heartbeats regularly but not too frequently
3. Clean up state files on graceful exit
4. Handle read/write errors gracefully

### For Monitoring Tools
1. Never write to state files (read-only access)
2. Use file system events for efficient monitoring
3. Account for heartbeat delays in staleness detection
4. Handle missing or corrupted files gracefully

### For System Administrators
1. State files are in `/tmp/` and cleaned on reboot
2. Can safely delete state files for inactive projects
3. Use `poltergeist clean` to remove stale files
4. Monitor disk usage in `/tmp/poltergeist/`

## Comparison with Traditional Approaches

### Traditional Lock Files
- **Pros**: Simple, widely understood
- **Cons**: Orphaned locks, no process info, separate files

### PID Files
- **Pros**: Contains process ID
- **Cons**: No liveness check, can be stale, limited info

### Database/Redis
- **Pros**: Rich queries, distributed locking
- **Cons**: External dependency, complexity, overhead

### Poltergeist State Files
- **Pros**: Self-contained, rich info, automatic recovery, no dependencies
- **Cons**: Local only, relies on file system atomicity

## Conclusion

Poltergeist's unified state file approach provides robust, lock-free coordination between build processes while enabling rich monitoring capabilities. By combining process information, build status, and liveness detection in a single atomic file, it eliminates common pitfalls of traditional locking mechanisms while providing a foundation for advanced features.