import SwiftUI
import AppKit
import os.log

@main
struct PoltergeistApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    
    var body: some Scene {
        WindowGroup {
            EmptyView()
                .frame(width: 0, height: 0)
                .onAppear {
                    NSApp.windows.forEach { $0.close() }
                }
        }
        
        Settings {
            SettingsView()
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "AppDelegate")
    private var statusBarController: StatusBarController?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        logger.info("Poltergeist Monitor starting...")
        
        // Initialize the status bar controller
        statusBarController = StatusBarController()
        
        // Hide dock icon
        NSApp.setActivationPolicy(.accessory)
    }
    
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        return false
    }
}

struct SettingsView: View {
    var body: some View {
        VStack {
            Text("Poltergeist Monitor Settings")
                .font(.title)
            Text("Settings coming soon...")
                .foregroundColor(.secondary)
        }
        .padding()
        .frame(width: 400, height: 300)
    }
}