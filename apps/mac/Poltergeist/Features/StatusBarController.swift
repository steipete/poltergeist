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
        logger.info("🚀 Initializing StatusBarController")
        setupStatusBar()
        startMonitoring()
    }
    
    private func setupStatusBar() {
        logger.info("📌 Setting up status bar item")
        
        // Create status item with proper length
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        
        // Mark as visible to prevent automatic removal
        statusItem?.isVisible = true
        
        if let button = statusItem?.button {
            logger.debug("✅ Status bar button created successfully")
            
            // Set a placeholder image first to ensure the item is retained
            if let placeholderImage = NSImage(systemSymbolName: "ghost.fill", accessibilityDescription: "Poltergeist") {
                placeholderImage.isTemplate = true
                button.image = placeholderImage
            }
            
            updateIcon()
            button.action = #selector(statusItemClicked)
            button.target = self
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            
            // Ensure the button stays in the status bar
            button.appearsDisabled = false
        } else {
            logger.error("❌ Failed to create status bar button!")
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
        logger.debug("📊 Projects updated notification received")
        updateIcon()
    }
    
    private func updateIcon() {
        logger.debug("🎨 Updating status bar icon")
        
        guard let button = statusItem?.button else {
            logger.error("❌ No status bar button available to update!")
            return
        }
        
        let projectCount = projectMonitor.projects.count
        let hasFailures = projectMonitor.projects.contains { project in
            project.targets.values.contains { $0.lastBuild?.status == "failed" }
        }
        
        logger.info("📈 Status: \(projectCount) projects, failures: \(hasFailures)")
        
        // Always ensure we have an image to prevent the icon from disappearing
        var iconSet = false
        
        // Use the StatusBarIcon from Assets
        if let image = NSImage(named: "StatusBarIcon") {
            logger.debug("✅ Using StatusBarIcon from assets")
            image.isTemplate = true
            image.size = NSSize(width: 18, height: 18)
            button.image = image
            iconSet = true
            
            // Set tint color for failures
            if hasFailures {
                button.contentTintColor = .systemRed
                logger.debug("🔴 Setting red tint for failures")
            } else {
                button.contentTintColor = nil
                logger.debug("⚪️ Clearing tint color")
            }
        } else {
            logger.warning("⚠️ StatusBarIcon not found in assets, falling back to SF Symbol")
        }
        
        // Fallback to SF Symbol if asset is missing
        if !iconSet {
            let symbolName = hasFailures ? "exclamationmark.circle.fill" : "ghost.fill"
            if let image = NSImage(systemSymbolName: symbolName, accessibilityDescription: "Poltergeist") {
                image.isTemplate = true
                button.image = image
                logger.debug("✅ Using SF Symbol: \(symbolName)")
                iconSet = true
                
                if hasFailures {
                    button.contentTintColor = .systemRed
                } else {
                    button.contentTintColor = nil
                }
            }
        }
        
        if !iconSet {
            logger.error("❌ Failed to load any icon!")
            // Create a simple fallback icon to prevent disappearing
            let fallbackImage = NSImage(size: NSSize(width: 18, height: 18))
            fallbackImage.lockFocus()
            NSColor.labelColor.setFill()
            NSBezierPath(ovalIn: NSRect(x: 4, y: 4, width: 10, height: 10)).fill()
            fallbackImage.unlockFocus()
            fallbackImage.isTemplate = true
            button.image = fallbackImage
            logger.info("🔨 Created fallback icon")
        }
        
        // Check if the status item is still visible
        if statusItem?.isVisible == false {
            logger.error("⚠️ Status item is not visible!")
        }
    }
    
    @objc private func statusItemClicked(_ sender: NSStatusBarButton?) {
        guard let event = NSApp.currentEvent else { return }
        
        if event.type == .rightMouseUp {
            showContextMenu()
        } else {
            togglePopover()
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
    
    private func showContextMenu() {
        let menu = NSMenu()
        
        // Projects section
        if !projectMonitor.projects.isEmpty {
            menu.addItem(NSMenuItem(title: "Projects", action: nil, keyEquivalent: ""))
            menu.addItem(.separator())
            
            for project in projectMonitor.projects.prefix(5) {
                let item = NSMenuItem(
                    title: project.name,
                    action: #selector(openProject(_:)),
                    keyEquivalent: ""
                )
                item.representedObject = project.path
                
                // Add status icon
                let config = project.overallStatus
                if let image = NSImage(systemSymbolName: config.icon, accessibilityDescription: nil) {
                    image.isTemplate = true
                    item.image = image
                }
                
                menu.addItem(item)
            }
            
            if projectMonitor.projects.count > 5 {
                menu.addItem(NSMenuItem(
                    title: "Show All Projects...",
                    action: #selector(showAllProjects),
                    keyEquivalent: ""
                ))
            }
            
            menu.addItem(.separator())
        }
        
        // Actions
        menu.addItem(NSMenuItem(
            title: "Open Poltergeist Monitor",
            action: #selector(showPopoverFromMenu),
            keyEquivalent: "p"
        ).with { $0.keyEquivalentModifierMask = [.command, .shift] })
        
        menu.addItem(.separator())
        
        // Maintenance
        menu.addItem(NSMenuItem(
            title: "Clean Up Inactive Projects",
            action: #selector(cleanupProjects),
            keyEquivalent: ""
        ))
        
        menu.addItem(NSMenuItem(
            title: "Refresh",
            action: #selector(refresh),
            keyEquivalent: "r"
        ).with { $0.keyEquivalentModifierMask = .command })
        
        menu.addItem(.separator())
        
        // Settings & About
        menu.addItem(NSMenuItem(
            title: "Settings...",
            action: #selector(openSettings),
            keyEquivalent: ","
        ).with { $0.keyEquivalentModifierMask = .command })
        
        menu.addItem(NSMenuItem(
            title: "About Poltergeist Monitor",
            action: #selector(showAbout),
            keyEquivalent: ""
        ))
        
        menu.addItem(.separator())
        
        // Quit
        menu.addItem(NSMenuItem(
            title: "Quit",
            action: #selector(NSApplication.terminate(_:)),
            keyEquivalent: "q"
        ).with { 
            $0.keyEquivalentModifierMask = .command 
            $0.target = NSApp
        })
        
        // Set targets for all items (except quit)
        menu.items.forEach { item in
            if item.action != #selector(NSApplication.terminate(_:)) {
                item.target = self
            }
        }
        
        // Show menu
        statusItem?.menu = menu
        statusItem?.button?.performClick(nil)
        statusItem?.menu = nil
    }
    
    // MARK: - Menu Actions
    
    @objc private func openProject(_ sender: NSMenuItem) {
        guard let path = sender.representedObject as? String else { return }
        NSWorkspace.shared.open(URL(fileURLWithPath: path))
    }
    
    @objc private func showAllProjects() {
        showPopoverFromMenu()
    }
    
    @objc private func showPopoverFromMenu() {
        if popover?.isShown == false {
            togglePopover()
        }
    }
    
    @objc private func cleanupProjects() {
        projectMonitor.cleanupInactiveProjects()
    }
    
    @objc private func refresh() {
        projectMonitor.refreshProjects()
    }
    
    @objc private func openSettings() {
        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
    }
    
    @objc private func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(nil)
    }
}