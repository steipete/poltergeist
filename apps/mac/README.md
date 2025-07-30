# Poltergeist for macOS

A native macOS menu bar app that watches your Xcode projects and automatically rebuilds them when files change.

## Features

- 👻 **Menu Bar App**: Lives in your menu bar for easy access
- 👁️ **File System Watching**: Monitors Swift, Objective-C, and resource files
- 🔨 **Automatic Builds**: Triggers xcodebuild when files change
- ⏱️ **Smart Debouncing**: Waits for file changes to settle before building
- 🔔 **Native Notifications**: macOS notifications for build results
- 📁 **Recent Projects**: Quick access to recently watched projects
- ⚡ **Lightweight**: Minimal CPU and memory usage

## Requirements

- macOS 14.0 or later
- Xcode 15.0 or later
- Swift 5.9 or later

## Installation

### Option 1: Build from Source

1. Clone the repository
2. Open `Poltergeist.xcodeproj` in Xcode
3. Select "Poltergeist" scheme
4. Build and run (⌘R)
5. The app will appear in your menu bar

### Option 2: Download Release

Download the latest `.dmg` from the [Releases](https://github.com/yourusername/poltergeist/releases) page.

## Usage

1. Click the Poltergeist icon in your menu bar
2. Select "Select Project..." to choose an Xcode project
3. The app will start watching for file changes
4. Edit your source files - builds will trigger automatically
5. See build status in the menu and receive notifications

### Keyboard Shortcuts

- **⌘B** - Trigger build manually
- **⌘,** - Open settings
- **⌘Q** - Quit Poltergeist

## Configuration

Poltergeist stores its configuration in UserDefaults. You can customize:

- **Debounce Interval**: Time to wait after file changes before building (default: 2 seconds)
- **Build Configuration**: Debug/Release (default: Debug)
- **Build Scheme**: Specific scheme to build
- **Watched File Extensions**: Which file types trigger builds
- **Excluded Paths**: Directories to ignore (build/, DerivedData/, etc.)

## Architecture

The app is built with SwiftUI and uses:

- **FSEvents API** for efficient file system monitoring
- **Process** for running xcodebuild
- **UserNotifications** for build result notifications
- **Combine** for reactive event handling

## Privacy

Poltergeist runs locally and doesn't collect any data. It only accesses the project directories you explicitly select.

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.