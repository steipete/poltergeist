//
//  PoltergeistApp.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import AppKit
import SwiftUI
import os.log

@main
struct PoltergeistApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) 
    var appDelegate
    
    // Modern dependency injection using @State and environment
    @State private var preferences = Preferences.shared
    @State private var projectMonitor = ProjectMonitor.shared

    var body: some Scene {
        // Status bar only app - no main window
        WindowGroup {
            EmptyView()
                .frame(width: 0, height: 0)
                .onAppear {
                    // Close any accidentally opened windows
                    NSApp.windows.forEach { window in
                        if window.isVisible {
                            window.close()
                        }
                    }
                }
        }
        .windowResizability(.contentSize)
        .windowStyle(.hiddenTitleBar)

        Settings {
            SettingsView()
                .environment(preferences)
                .environment(projectMonitor)
        }
    }
}

/// Modern app delegate with Swift 6 concurrency support
@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "AppDelegate")
    private var statusBarController: StatusBarController?

    nonisolated func applicationDidFinishLaunching(_ notification: Notification) {
        Task { @MainActor in
            await setupApplication()
        }
    }
    
    private func setupApplication() async {
        logger.info("🚀 Poltergeist Monitor starting...")

        // Configure app behavior
        NSApp.setActivationPolicy(.accessory)
        
        // Initialize core services
        setupStatusBar()
        
        logger.info("✅ Poltergeist Monitor startup complete")
    }
    
    private func setupStatusBar() {
        statusBarController = StatusBarController()
    }

    nonisolated func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Keep running even if all windows are closed (status bar app)
        false
    }
    
    nonisolated func applicationWillTerminate(_ notification: Notification) {
        Task { @MainActor in
            logger.info("🛑 Poltergeist Monitor shutting down...")
            statusBarController = nil
        }
    }
}
