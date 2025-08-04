//
//  StatusBarController.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import AppKit
import SwiftUI
import os.log

/// Modern status bar controller with proper Swift 6 concurrency support
@MainActor
final class StatusBarController: NSObject {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "StatusBar")
    private var statusItem: NSStatusItem?
    private var popover: NSPopover?
    private let projectMonitor = ProjectMonitor.shared

    override init() {
        super.init()
        logger.info("🚀 Initializing StatusBarController")
        Task {
            await setupStatusBar()
            await startMonitoring()
        }
    }

    private func setupStatusBar() async {
        logger.info("📌 Setting up status bar item")

        // Create status item with fixed length to prevent resizing issues
        statusItem = NSStatusBar.system.statusItem(withLength: 26)

        // Mark as visible to prevent automatic removal
        statusItem?.isVisible = true

        guard let button = statusItem?.button else {
            logger.error("❌ Failed to create status bar button!")
            return
        }

        logger.debug("✅ Status bar button created successfully")
        await configureButton(button)
    }

    private func configureButton(_ button: NSStatusBarButton) async {
        // Configure icon with modern async pattern
        let icon = await loadStatusBarIcon()
        button.image = icon

        // Configure button behavior
        button.action = #selector(statusItemClicked)
        button.target = self
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        button.appearsDisabled = false
    }

    private func loadStatusBarIcon() async -> NSImage? {
        // Try custom icon first
        if let image = NSImage(named: "StatusBarIcon") {
            image.isTemplate = true
            logger.debug("✅ Loaded custom StatusBarIcon")
            return image
        }

        // Fallback to SF Symbol
        if let image = NSImage(
            systemSymbolName: "ghost.fill", accessibilityDescription: "Poltergeist")
        {
            image.isTemplate = true
            logger.debug("✅ Loaded SF Symbol ghost icon")
            return image
        }

        logger.warning("⚠️ No status bar icon available")
        return nil
    }

    private func startMonitoring() async {
        projectMonitor.startMonitoring()
        logger.debug("✅ Project monitoring started")
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
        popover.contentSize = NSSize(width: 480, height: 600)
        popover.behavior = .transient
        popover.animates = true

        let contentView = StatusBarMenuView {
            popover.performClose(nil)
        }
        .environment(projectMonitor)
        .environment(Preferences.shared)

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
                if let image = NSImage(systemSymbolName: config.icon, accessibilityDescription: nil)
                {
                    image.isTemplate = true
                    item.image = image
                }

                menu.addItem(item)
            }

            if projectMonitor.projects.count > 5 {
                menu.addItem(
                    NSMenuItem(
                        title: "Show All Projects...",
                        action: #selector(showAllProjects),
                        keyEquivalent: ""
                    ))
            }

            menu.addItem(.separator())
        }

        // Actions
        menu.addItem(
            NSMenuItem(
                title: "Open Poltergeist Monitor",
                action: #selector(showPopoverFromMenu),
                keyEquivalent: "p"
            ).with { $0.keyEquivalentModifierMask = [.command, .shift] })

        menu.addItem(.separator())

        // Maintenance
        menu.addItem(
            NSMenuItem(
                title: "Clean Up Inactive Projects",
                action: #selector(cleanupProjects),
                keyEquivalent: ""
            ))

        menu.addItem(
            NSMenuItem(
                title: "Refresh",
                action: #selector(refresh),
                keyEquivalent: "r"
            ).with { $0.keyEquivalentModifierMask = .command })

        menu.addItem(.separator())

        // About (Settings is in SwiftUI popover menu only)
        menu.addItem(
            NSMenuItem(
                title: "About Poltergeist Monitor",
                action: #selector(showAbout),
                keyEquivalent: ""
            ))

        menu.addItem(.separator())

        // Quit
        menu.addItem(
            NSMenuItem(
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


    @objc private func showAbout() {
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(nil)
    }
    
    // MARK: - Lifecycle
    
    deinit {
        logger.info("🗑️ StatusBarController deallocating")
        cleanupStatusBar()
    }
    
    private func cleanupStatusBar() {
        popover?.performClose(nil)
        popover = nil
        
        if let statusItem = statusItem {
            NSStatusBar.system.removeStatusItem(statusItem)
            logger.debug("✅ Status bar item removed")
        }
        statusItem = nil
    }
    
}
