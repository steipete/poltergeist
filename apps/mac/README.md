# Poltergeist Mac Monitor App

A native macOS menu bar application that monitors all Poltergeist instances across your projects.

## Overview

Poltergeist Monitor is a companion app for the Poltergeist build system. It provides a unified view of all running Poltergeist instances, showing build status, errors, and allowing easy management of watched projects.

## Features

- **Menu Bar Status**: Shows a ghost icon that turns red when any builds fail
- **Project Overview**: Lists all projects with active Poltergeist instances
- **Target Status**: Shows build status for each target (cli, macApp, etc.)
- **Build Details**: View build times, git hashes, and timestamps
- **Error Details**: Click on projects to see full error messages
- **Automatic Updates**: Monitors `/tmp/poltergeist/` for state file changes
- **Process Monitoring**: Tracks active instances via PID with heartbeat detection
- **Cleanup Tools**: Right-click to remove inactive projects or clean up stale state files

## Requirements

- macOS 15.0+
- Xcode 16.0+
- Swift 6.0

## Building

1. Open `Poltergeist.xcodeproj` in Xcode
2. Select the Poltergeist scheme
3. Build and run (⌘R)

The app uses modern Xcode file system synchronized groups, so any files added to the `Poltergeist/` folder will automatically be included in the project.

## Usage

1. Start Poltergeist in your projects using `poltergeist haunt`
2. Launch the Poltergeist Monitor app
3. Click the ghost icon in your menu bar to see all active projects
4. Click on any project to see detailed status and errors

## Architecture

### Core Components

- **StatusBarController**: Manages the menu bar icon and popover
- **ProjectMonitor**: Watches `/tmp/poltergeist/` for state file changes
- **FileWatcher**: Uses FSEvents API for efficient file system monitoring
- **Project/TargetState**: Data models for tracking build status

### State File Communication

Poltergeist instances write state files to `/tmp/poltergeist/` with the format:
```
{projectName}-{projectHash}-{target}.state
```

Each state file contains:
- Process information (PID, heartbeat)
- Last build status and timing
- Error messages if any
- Application info (bundle ID, output path)

### File System Synchronized Groups

The project uses Xcode 16's `PBXFileSystemSynchronizedRootGroup` which automatically syncs the file system with the Xcode project. This means:
- No manual file management in Xcode
- Files added to disk appear in the project automatically
- Deletions and renames are synchronized

## Development

The app is built with:
- **SwiftUI** for the user interface
- **FSEvents** for file system monitoring
- **AppKit** for menu bar integration
- **Combine** for reactive updates

## License

Part of the Poltergeist project - see main repository for license details.