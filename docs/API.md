# Poltergeist API Documentation

This document provides comprehensive API documentation for integrating with and extending Poltergeist.

## Table of Contents

- [Configuration API](#configuration-api)
- [State Management API](#state-management-api)
- [Builder API](#builder-api)
- [CLI Integration](#cli-integration)
- [macOS App Integration](#macos-app-integration)
- [External Tool Integration](#external-tool-integration)

## Configuration API

### Configuration Schema

The complete configuration interface for `poltergeist.config.json`:

```typescript
interface PoltergeistConfig {
  version: "1.0"
  projectType: "swift" | "node" | "rust" | "python" | "mixed"
  targets: TargetConfig[]
  watchman?: WatchmanConfig
  performance?: PerformanceConfig
  buildScheduling?: BuildSchedulingConfig
  notifications?: NotificationConfig
  logging?: LoggingConfig
}
```

### Target Configuration

```typescript
interface TargetConfig {
  name: string
  type: "executable" | "app-bundle" | "library" | "framework" | "test" | "docker" | "custom"
  enabled?: boolean
  buildCommand: string
  outputPath?: string
  watchPaths: string[]
  excludePaths?: string[]
  
  // Environment and execution
  environment?: Record<string, string>
  workingDirectory?: string
  maxRetries?: number
  settlingDelay?: number
  
  // Type-specific configurations
  bundleId?: string        // app-bundle only
  autoRelaunch?: boolean   // app-bundle only
  libraryType?: "static" | "dynamic"  // library only
  testCommand?: string     // test only
  coverageFile?: string    // test only
  imageName?: string       // docker only
  dockerfile?: string      // docker only
  tags?: string[]          // docker only
  config?: Record<string, any>  // custom only
}
```

### Advanced Configuration Options

```typescript
interface WatchmanConfig {
  useDefaultExclusions?: boolean
  excludeDirs?: string[]
  maxFileEvents?: number
  recrawlThreshold?: number
  settlingDelay?: number
  rules?: WatchmanRule[]
}

interface WatchmanRule {
  pattern: string
  action: "ignore" | "include"
}

interface PerformanceConfig {
  profile: "conservative" | "balanced" | "aggressive"
  autoOptimize?: boolean
}

interface BuildSchedulingConfig {
  parallelization?: number
  prioritization?: {
    enabled: boolean
    focusDetectionWindow: number
  }
}

interface NotificationConfig {
  enabled?: boolean
  successSound?: string
  failureSound?: string
}

interface LoggingConfig {
  file?: string
  level?: "error" | "warn" | "info" | "debug"
}
```

### Configuration Examples

#### Swift Package Manager Project
```json
{
  "version": "1.0",
  "projectType": "swift",
  "targets": [
    {
      "name": "cli-tool",
      "type": "executable",
      "buildCommand": "swift build -c release",
      "outputPath": "./.build/release/MyTool",
      "watchPaths": ["Sources/**/*.swift", "Package.swift"],
      "environment": {
        "SWIFT_BUILD_CONFIGURATION": "release"
      }
    },
    {
      "name": "tests",
      "type": "test",
      "testCommand": "swift test --parallel",
      "watchPaths": ["Sources/**/*.swift", "Tests/**/*.swift"],
      "coverageFile": ".build/debug/codecov/coverage.json"
    }
  ],
  "buildScheduling": {
    "parallelization": 2,
    "prioritization": {
      "enabled": true,
      "focusDetectionWindow": 300000
    }
  }
}
```

#### Multi-Language Project
```json
{
  "version": "1.0",
  "projectType": "mixed",
  "targets": [
    {
      "name": "swift-backend",
      "type": "executable",
      "buildCommand": "./scripts/build-swift.sh",
      "outputPath": "./bin/backend",
      "watchPaths": ["Backend/**/*.swift", "Shared/**/*.swift"],
      "workingDirectory": "./Backend"
    },
    {
      "name": "react-frontend", 
      "type": "custom",
      "buildCommand": "npm run build:prod",
      "outputPath": "./frontend/dist",
      "watchPaths": ["frontend/src/**/*.{ts,tsx,js,jsx}"],
      "environment": {
        "NODE_ENV": "production"
      },
      "config": {
        "outputDir": "./frontend/dist",
        "publicPath": "/app/"
      }
    },
    {
      "name": "mac-app",
      "type": "app-bundle",
      "bundleId": "com.example.myapp",
      "buildCommand": "xcodebuild -scheme MyApp -configuration Release",
      "autoRelaunch": true,
      "watchPaths": ["MacApp/**/*.swift", "Shared/**/*.swift"]
    }
  ],
  "performance": {
    "profile": "balanced",
    "autoOptimize": true
  }
}
```

## State Management API

### State File Structure

Poltergeist maintains state in `/tmp/poltergeist/` using the following schema:

```typescript
interface PoltergeistState {
  // Project information
  projectName: string
  projectPath: string
  target: string
  
  // Process management
  process: ProcessInfo
  
  // Build information
  lastBuild?: BuildInfo
  
  // App-specific metadata (app-bundle targets only)
  app?: AppInfo
}

interface ProcessInfo {
  pid: number
  hostname: string
  isActive: boolean
  startTime: string     // ISO8601
  lastHeartbeat: string // ISO8601
}

interface BuildInfo {
  status: "building" | "success" | "failure"
  timestamp: string     // ISO8601
  startTime?: string    // ISO8601
  buildTime?: number    // milliseconds
  gitHash?: string
  errorSummary?: string
  buildProgress?: number // 0-1
  estimatedDuration?: number // milliseconds
  currentPhase?: string
}

interface AppInfo {
  bundleId: string
  path?: string
  version?: string
  isRunning?: boolean
}
```

### State File Naming Convention

State files use the pattern: `{projectName}-{hash}-{target}.state`

- `projectName`: Sanitized project name
- `hash`: 8-character hash of project path
- `target`: Target name from configuration

Example: `my-project-a1b2c3d4-cli-tool.state`

### Reading State Files

```typescript
import { readFileSync } from 'fs'
import { join } from 'path'

function readProjectState(projectName: string, hash: string, target: string): PoltergeistState | null {
  const stateFile = join('/tmp/poltergeist', `${projectName}-${hash}-${target}.state`)
  
  try {
    const data = readFileSync(stateFile, 'utf8')
    return JSON.parse(data) as PoltergeistState
  } catch (error) {
    return null
  }
}

// Check if process is still active
function isProcessActive(state: PoltergeistState): boolean {
  if (!state.process.isActive) return false
  
  const heartbeat = new Date(state.process.lastHeartbeat)
  const staleThreshold = 5 * 60 * 1000 // 5 minutes
  
  return Date.now() - heartbeat.getTime() < staleThreshold
}
```

### State File Integration Examples

#### Shell Script Integration
```bash
#!/bin/bash

# Check if Poltergeist is running for a target
check_poltergeist_status() {
  local target="$1"
  local state_file="/tmp/poltergeist/*-${target}.state"
  
  if [ -f $state_file ]; then
    local status=$(jq -r '.lastBuild.status' "$state_file" 2>/dev/null)
    echo "Target $target status: $status"
    return $([[ "$status" == "success" ]] && echo 0 || echo 1)
  else
    echo "Target $target not found"
    return 1
  fi
}

# Usage
if check_poltergeist_status "my-app"; then
  echo "✅ Build is fresh, running application"
  ./bin/my-app
else
  echo "❌ Build failed or not ready"
  exit 1
fi
```

#### Python Integration
```python
import json
import glob
import os
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

class PoltergeistClient:
    def __init__(self, state_dir: str = "/tmp/poltergeist"):
        self.state_dir = state_dir
    
    def get_project_state(self, target: str) -> Optional[Dict[str, Any]]:
        """Get state for a specific target."""
        pattern = os.path.join(self.state_dir, f"*-{target}.state")
        state_files = glob.glob(pattern)
        
        if not state_files:
            return None
            
        with open(state_files[0], 'r') as f:
            return json.load(f)
    
    def is_build_fresh(self, target: str, max_age_minutes: int = 10) -> bool:
        """Check if build is recent and successful."""
        state = self.get_project_state(target)
        if not state or not state.get('lastBuild'):
            return False
            
        build = state['lastBuild']
        if build['status'] != 'success':
            return False
            
        build_time = datetime.fromisoformat(build['timestamp'].replace('Z', '+00:00'))
        age = datetime.now() - build_time.replace(tzinfo=None)
        
        return age < timedelta(minutes=max_age_minutes)
    
    def wait_for_build(self, target: str, timeout_seconds: int = 60) -> bool:
        """Wait for a build to complete successfully."""
        import time
        
        start_time = time.time()
        while time.time() - start_time < timeout_seconds:
            state = self.get_project_state(target)
            if state and state.get('lastBuild'):
                status = state['lastBuild']['status']
                if status == 'success':
                    return True
                elif status == 'failure':
                    return False
            
            time.sleep(1)
        
        return False

# Usage example
client = PoltergeistClient()

if client.is_build_fresh("my-api"):
    print("✅ API build is fresh")
    # Start API server
elif client.wait_for_build("my-api", timeout_seconds=30):
    print("✅ API build completed successfully")
    # Start API server
else:
    print("❌ API build failed or timed out")
    exit(1)
```

## Builder API

### Custom Builder Implementation

Create custom builders by extending the base builder class:

```typescript
import { BaseBuilder } from './base-builder'
import { TargetConfig, BuildResult } from '../types'

export class CustomBuilder extends BaseBuilder {
  constructor(target: TargetConfig, projectPath: string) {
    super(target, projectPath)
  }

  async build(): Promise<BuildResult> {
    this.logger.info(`Building custom target: ${this.target.name}`)
    
    try {
      // Pre-build validation
      await this.validateConfiguration()
      
      // Execute build command
      const result = await this.executeBuildCommand()
      
      // Post-build processing
      await this.processBuildOutput(result)
      
      return {
        success: true,
        output: result.stdout,
        duration: result.duration,
        artifacts: await this.collectArtifacts()
      }
    } catch (error) {
      return {
        success: false,
        error: error.message,
        output: error.stdout || '',
        duration: 0
      }
    }
  }

  private async validateConfiguration(): Promise<void> {
    // Custom validation logic
    const config = this.target.config
    if (!config?.requiredField) {
      throw new Error('Missing required configuration field')
    }
  }

  private async processBuildOutput(result: any): Promise<void> {
    // Custom post-processing
    if (this.target.config?.generateManifest) {
      await this.generateBuildManifest(result)
    }
  }

  private async collectArtifacts(): Promise<string[]> {
    // Return list of generated artifacts
    return [
      this.target.outputPath || './dist',
      './build-manifest.json'
    ]
  }
}
```

### Builder Registration

Register custom builders in your application:

```typescript
import { BuilderFactory } from './factories'
import { CustomBuilder } from './builders/custom-builder'

// Register custom builder
BuilderFactory.registerBuilder('custom', CustomBuilder)

// Use in configuration
const config = {
  targets: [
    {
      name: "my-custom-target",
      type: "custom",
      buildCommand: "./scripts/custom-build.sh",
      config: {
        requiredField: "value",
        generateManifest: true
      }
    }
  ]
}
```

## CLI Integration

### Programmatic CLI Usage

```typescript
import { Poltergeist } from '@steipete/poltergeist'

async function runPoltergeist() {
  const poltergeist = new Poltergeist({
    configPath: './poltergeist.config.json',
    verboseLogging: true
  })

  // Start monitoring
  await poltergeist.start()

  // Listen for build events
  poltergeist.on('buildStart', (target) => {
    console.log(`Build started for ${target.name}`)
  })

  poltergeist.on('buildComplete', (target, result) => {
    console.log(`Build ${result.success ? 'succeeded' : 'failed'} for ${target.name}`)
  })

  // Stop after some time
  setTimeout(async () => {
    await poltergeist.stop()
  }, 60000)
}
```

### Custom CLI Commands

Extend the CLI with custom commands:

```typescript
import { Command } from 'commander'
import { PoltergeistConfig } from './config'

export function createCustomCommand(): Command {
  return new Command('analyze')
    .description('Analyze build performance')
    .option('-t, --target <name>', 'Target to analyze')
    .option('-d, --days <number>', 'Days to analyze', '7')
    .action(async (options) => {
      const config = await PoltergeistConfig.load()
      const analyzer = new BuildAnalyzer(config)
      
      const report = await analyzer.generateReport({
        target: options.target,
        days: parseInt(options.days)
      })
      
      console.log(report)
    })
}

// Register command
program.addCommand(createCustomCommand())
```

## macOS App Integration

### Swift Integration with CLI State

```swift
import Foundation

class PoltergeistStateReader {
    private let stateDirectory = "/tmp/poltergeist"
    
    func readProjectStates() -> [PoltergeistState] {
        guard let files = try? FileManager.default.contentsOfDirectory(atPath: stateDirectory) else {
            return []
        }
        
        return files
            .filter { $0.hasSuffix(".state") }
            .compactMap { readStateFile($0) }
    }
    
    private func readStateFile(_ filename: String) -> PoltergeistState? {
        let filePath = "\(stateDirectory)/\(filename)"
        
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: filePath)),
              let state = try? JSONDecoder().decode(PoltergeistState.self, from: data) else {
            return nil
        }
        
        return state
    }
}

// SwiftUI View Integration
struct ProjectStatusView: View {
    @StateObject private var stateReader = PoltergeistStateReader()
    @State private var states: [PoltergeistState] = []
    
    var body: some View {
        List(states, id: \.target) { state in
            HStack {
                Image(systemName: state.lastBuild?.status == "success" ? "checkmark.circle.fill" : "xmark.circle.fill")
                    .foregroundColor(state.lastBuild?.status == "success" ? .green : .red)
                
                VStack(alignment: .leading) {
                    Text(state.target)
                        .font(.headline)
                    Text(state.projectName)
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                
                Spacer()
                
                if let build = state.lastBuild {
                    Text(formatBuildTime(build.buildTime))
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
            }
        }
        .onAppear {
            loadStates()
        }
    }
    
    private func loadStates() {
        states = stateReader.readProjectStates()
    }
    
    private func formatBuildTime(_ milliseconds: Double?) -> String {
        guard let ms = milliseconds else { return "—" }
        return String(format: "%.1fs", ms / 1000)
    }
}
```

### Notification Integration

```swift
import UserNotifications

class BuildNotificationManager {
    func requestPermission() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
            if granted {
                print("Notification permission granted")
            }
        }
    }
    
    func notifyBuildComplete(project: String, target: String, success: Bool, duration: TimeInterval) {
        let content = UNMutableNotificationContent()
        content.title = success ? "Build Succeeded" : "Build Failed"
        content.body = "\(project):\(target) completed in \(String(format: "%.1fs", duration))"
        content.sound = success ? .default : .defaultCritical
        
        let request = UNNotificationRequest(
            identifier: "\(project)-\(target)-\(Date().timeIntervalSince1970)",
            content: content,
            trigger: nil
        )
        
        UNUserNotificationCenter.current().add(request)
    }
}
```

## External Tool Integration

### CI/CD Integration

#### GitHub Actions Integration
```yaml
name: Build with Poltergeist

on: [push, pull_request]

jobs:
  build:
    runs-on: macos-latest
    
    steps:
    - uses: actions/checkout@v4
    
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '20'
        
    - name: Install Watchman
      run: brew install watchman
      
    - name: Install Poltergeist
      run: npm install -g @steipete/poltergeist
      
    - name: Configure Poltergeist
      run: |
        cat > poltergeist.config.json << EOF
        {
          "version": "1.0",
          "projectType": "swift",
          "targets": [
            {
              "name": "ci-build",
              "type": "executable",
              "buildCommand": "swift build -c release",
              "outputPath": "./.build/release/MyApp"
            }
          ]
        }
        EOF
    
    - name: Build with Poltergeist
      run: |
        timeout 300 poltergeist haunt &
        POLTERGEIST_PID=$!
        
        # Wait for build completion
        while [ ! -f "/tmp/poltergeist/*-ci-build.state" ]; do
          sleep 1
        done
        
        # Check build status
        if polter ci-build --version; then
          echo "✅ Build successful"
        else
          echo "❌ Build failed"
          exit 1
        fi
        
        kill $POLTERGEIST_PID
```

#### Docker Integration
```dockerfile
FROM node:20-alpine

# Install Watchman
RUN apk add --no-cache watchman

# Install Poltergeist
RUN npm install -g @steipete/poltergeist

# Copy project
COPY . /app
WORKDIR /app

# Start Poltergeist
CMD ["poltergeist", "haunt"]
```

### IDE Integration

#### VS Code Extension Template
```typescript
import * as vscode from 'vscode'
import { spawn } from 'child_process'

export function activate(context: vscode.ExtensionContext) {
    // Register command to start Poltergeist
    const startCommand = vscode.commands.registerCommand('poltergeist.start', () => {
        const terminal = vscode.window.createTerminal('Poltergeist')
        terminal.sendText('poltergeist haunt')
        terminal.show()
    })

    // Status bar item
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100)
    statusBarItem.command = 'poltergeist.showStatus'
    statusBarItem.text = '$(sync~spin) Poltergeist'
    statusBarItem.show()

    // Watch for state changes
    const watcher = vscode.workspace.createFileSystemWatcher('/tmp/poltergeist/*.state')
    watcher.onDidChange(() => {
        updateStatusBar(statusBarItem)
    })

    context.subscriptions.push(startCommand, statusBarItem, watcher)
}

function updateStatusBar(statusBarItem: vscode.StatusBarItem) {
    // Read state files and update status
    // Implementation depends on your specific needs
}
```

### Webhook Integration

```typescript
import express from 'express'
import { readFileSync } from 'fs'
import { glob } from 'glob'

const app = express()

app.get('/api/status', (req, res) => {
  const stateFiles = glob.sync('/tmp/poltergeist/*.state')
  const states = stateFiles.map(file => {
    try {
      return JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      return null
    }
  }).filter(Boolean)

  res.json({
    projects: states.length,
    building: states.filter(s => s.lastBuild?.status === 'building').length,
    successful: states.filter(s => s.lastBuild?.status === 'success').length,
    failed: states.filter(s => s.lastBuild?.status === 'failure').length,
    states
  })
})

app.post('/api/webhook/build-complete', (req, res) => {
  const { project, target, success, duration } = req.body
  
  // Send notification or trigger downstream processes
  if (success) {
    console.log(`✅ ${project}:${target} built successfully in ${duration}ms`)
    // Trigger deployment, send slack notification, etc.
  } else {
    console.log(`❌ ${project}:${target} build failed`)
    // Send alert, create ticket, etc.
  }
  
  res.json({ received: true })
})

app.listen(3000, () => {
  console.log('Poltergeist webhook server running on port 3000')
})
```

## Type Definitions

For TypeScript integration, Poltergeist exports comprehensive type definitions:

```typescript
// Import types for your integrations
import type {
  PoltergeistConfig,
  TargetConfig,
  PoltergeistState,
  BuildInfo,
  ProcessInfo,
  BuildResult
} from '@steipete/poltergeist'

// Use in your applications
function processBuildState(state: PoltergeistState): void {
  if (state.lastBuild?.status === 'success') {
    console.log(`Build completed in ${state.lastBuild.buildTime}ms`)
  }
}
```

---

This API documentation provides the foundation for integrating with and extending Poltergeist. For additional examples and advanced use cases, see the [examples/](../examples/) directory and [CONTRIBUTING.md](../CONTRIBUTING.md).