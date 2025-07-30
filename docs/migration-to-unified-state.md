# Migration Guide: Unified State System

## Overview

Poltergeist 2.0 introduces a unified state file system that replaces the previous separate lock and status files. This provides better reliability, atomic updates, and comprehensive project tracking.

## What's Changed

### Before (Old System)
- Separate lock files: `/tmp/peekaboo-poltergeist.lock`
- Separate status files: `/tmp/peekaboo-build-status.json`
- Potential for file collisions between projects
- No heartbeat mechanism
- Limited metadata

### After (Unified State System)
- Single state file per target: `/tmp/poltergeist/projectname-hash-targetname.state`
- Includes lock info (PID), build status, and app metadata
- Unique file names using project path hash
- Heartbeat mechanism for liveness detection
- Rich metadata including icons and output paths

## State File Format

The new state files contain all information in a single JSON structure:

```json
{
  "version": "1.0",
  "projectPath": "/Users/you/Projects/my-app",
  "projectName": "my-app",
  "target": "cli",
  "targetType": "executable",
  "configPath": "/Users/you/Projects/my-app/.poltergeist.json",
  
  "process": {
    "pid": 12345,
    "hostname": "your-mac",
    "isActive": true,
    "startTime": "2024-01-20T10:30:00Z",
    "lastHeartbeat": "2024-01-20T10:35:00Z"
  },
  
  "lastBuild": {
    "status": "success",
    "timestamp": "2024-01-20T10:34:55Z",
    "duration": 1234,
    "buildTime": 1.234
  },
  
  "appInfo": {
    "outputPath": "/path/to/output/binary",
    "iconPath": "Assets/icon.png"
  }
}
```

## Configuration Changes

### Old Configuration
```json
{
  "cli": {
    "enabled": true,
    "buildCommand": "npm run build",
    "statusFile": "/tmp/peekaboo-build-status.json",
    "lockFile": "/tmp/peekaboo-poltergeist.lock"
  }
}
```

### New Configuration
```json
{
  "targets": [
    {
      "name": "cli",
      "type": "executable",
      "enabled": true,
      "buildCommand": "npm run build",
      "outputPath": "./dist/cli",
      "watchPaths": ["src/**/*.ts"],
      "icon": "assets/cli-icon.png"
    }
  ]
}
```

**Note**: `statusFile` and `lockFile` are no longer needed in configuration. The system automatically manages state files in `/tmp/poltergeist/`.

## Benefits

1. **No More Collisions**: Each project gets unique state files based on project path hash
2. **Atomic Updates**: State updates are atomic (write to temp file, then rename)
3. **Better Monitoring**: Mac app and other tools can easily discover all Poltergeist instances
4. **Process Tracking**: Heartbeat mechanism ensures stale states are detected
5. **Richer Metadata**: Icons, output paths, and build info all in one place

## For Tool Developers

### Discovering Poltergeist Instances

```typescript
// List all state files
const stateDir = '/tmp/poltergeist';
const files = fs.readdirSync(stateDir);
const stateFiles = files.filter(f => f.endsWith('.state'));

// Parse state file
const state = JSON.parse(fs.readFileSync(path.join(stateDir, stateFile), 'utf-8'));

// Check if process is active
const isActive = state.process.isActive && 
  (Date.now() - new Date(state.process.lastHeartbeat).getTime() < 30000);
```

### File Naming Convention

Files are named: `{projectName}-{projectHash}-{targetName}.state`

- `projectName`: Last component of project path (human-readable)
- `projectHash`: First 8 chars of SHA-256 hash of full project path
- `targetName`: Target name from configuration

Example: `my-app-a3f2c891-cli.state`

## Troubleshooting

### Clean Up Old Files

After upgrading, you can safely remove old lock and status files:

```bash
# Remove old status files
rm -f /tmp/peekaboo-*-build-status.json
rm -f /tmp/peekaboo-build-status.json

# Remove old lock files  
rm -f /tmp/peekaboo-poltergeist.lock
rm -f /tmp/poltergeist-lock-*
```

### State Directory Permissions

Ensure the state directory exists and is writable:

```bash
mkdir -p /tmp/poltergeist
chmod 755 /tmp/poltergeist
```

## API Changes

### For Poltergeist Users

No changes required! The CLI commands remain the same:
- `poltergeist haunt` - Start watching
- `poltergeist status` - Check status
- `poltergeist stop` - Stop watching

### For Library Users

If you're using Poltergeist as a library:

```typescript
// Old
import { Poltergeist } from 'poltergeist';
const p = new Poltergeist(config, projectRoot);

// New (same API, but uses StateManager internally)
import { PoltergeistV2 } from 'poltergeist';
const p = new PoltergeistV2(config, projectRoot);
```

## FAQ

**Q: What happens to my old lock/status files?**
A: They're ignored by the new system. You can safely delete them.

**Q: Do I need to update my configuration?**
A: Remove `statusFile` and `lockFile` from your config. They're no longer used.

**Q: Can I run old and new versions simultaneously?**
A: No, they use different state tracking systems. Upgrade all instances.

**Q: Where are the new state files stored?**
A: In `/tmp/poltergeist/` directory, with unique names per project/target.

**Q: How often is the heartbeat updated?**
A: Every 10 seconds while Poltergeist is running.

**Q: What if Poltergeist crashes?**
A: The heartbeat will stop updating, and after 5 minutes the state is considered stale.