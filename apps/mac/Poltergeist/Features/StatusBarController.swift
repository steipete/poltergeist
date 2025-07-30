import AppKit
import SwiftUI
import os.log

@MainActor
final class StatusBarController: NSObject {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "StatusBar")
    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private let projectMonitor = ProjectMonitor.shared
    
    override init() {
        super.init()
        setupStatusBar()
        startMonitoring()
    }
    
    private func setupStatusBar() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        
        if let button = statusItem?.button {
            updateIcon()
            button.action = #selector(togglePopover)
            button.target = self
        }
    }
    
    private func startMonitoring() {
        projectMonitor.startMonitoring()
        
        // Update icon when project status changes
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(projectsUpdated),
            name: ProjectMonitor.projectsDidUpdateNotification,
            object: nil
        )
    }
    
    @objc private func projectsUpdated() {
        updateIcon()
    }
    
    private func updateIcon() {
        guard let button = statusItem?.button else { return }
        
        let hasFailures = projectMonitor.projects.contains { project in
            project.targets.values.contains { $0.lastBuild?.status == "failed" }
        }
        
        let symbolName = hasFailures ? "exclamationmark.circle.fill" : "ghost.fill"
        
        if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Poltergeist") {
            image.isTemplate = true
            button.image = image
            // Don't set contentTintColor for template images - let the system handle it
            // Only set red color for failures
            if hasFailures {
                button.contentTintColor = .systemRed
            } else {
                button.contentTintColor = nil
            }
        }
    }
    
    @objc private func togglePopover() {
        if let popover = popover {
            if popover.isShown {
                popover.performClose(nil)
            } else {
                showPopover()
            }
        } else {
            showPopover()
        }
    }
    
    private func showPopover() {
        guard let button = statusItem?.button else { return }
        
        let popover = NSPopover()
        popover.contentSize = NSSize(width: 400, height: 600)
        popover.behavior = .transient
        popover.animates = true
        
        let contentView = StatusBarMenuView(projectMonitor: projectMonitor) {
            popover.performClose(nil)
        }
        
        popover.contentViewController = NSHostingController(rootView: contentView)
        popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
        
        self.popover = popover
    }
}