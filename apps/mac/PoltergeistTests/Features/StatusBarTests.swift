//
//  StatusBarTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
import AppKit
@testable import Poltergeist

// MARK: - Test Tags
extension Tag {
    @Tag static var features: Self
    @Tag static var ui: Self
}

// MARK: - Status Bar Tests
@Suite("Status Bar Tests", .tags(.features, .ui))
@MainActor
struct StatusBarTests {
    
    // MARK: - Status Bar Icon Tests
    
    @Test("Status bar icon state mapping", arguments: [
        (Project.BuildStatus.idle, "circle.dotted", NSColor.systemGray),
        (Project.BuildStatus.building, "arrow.triangle.2.circlepath", NSColor.systemBlue),
        (Project.BuildStatus.success, "checkmark.circle.fill", NSColor.systemGreen),
        (Project.BuildStatus.failed, "xmark.circle.fill", NSColor.systemRed)
    ])
    func testStatusBarIconMapping(
        status: Project.BuildStatus,
        expectedIcon: String,
        expectedColor: NSColor
    ) {
        #expect(status.icon == expectedIcon)
        #expect(status.color == expectedColor)
    }
    
    @Test("Status bar icon creation")
    func testStatusBarIconCreation() {
        let statuses: [Project.BuildStatus] = [.idle, .building, .success, .failed]
        
        for status in statuses {
            let iconName = status.icon
            let color = status.color
            
            // Test that we can create NSImage from system icon name
            let image = NSImage(systemSymbolName: iconName, accessibilityDescription: nil)
            #expect(image != nil)
            
            // Test that color is a valid NSColor
            #expect(color != nil)
            #expect(color.colorSpace != nil)
        }
    }
    
    // MARK: - Menu Item Creation Tests
    
    @Test("Menu item creation for project")
    func testMenuItemCreationForProject() {
        let project = Project(
            path: "/Users/test/MyProject",
            name: "MyProject",
            hash: "abc123"
        )
        
        // Create a basic menu item structure
        let menuItem = NSMenuItem()
        menuItem.title = project.name
        menuItem.toolTip = project.path
        
        #expect(menuItem.title == "MyProject")
        #expect(menuItem.toolTip == "/Users/test/MyProject")
        #expect(menuItem.isEnabled == true) // Default
    }
    
    @Test("Menu item with target information")
    func testMenuItemWithTargetInformation() {
        var project = Project(
            path: "/test",
            name: "TestProject",  
            hash: "hash"
        )
        
        let buildInfo = BuildInfo(
            status: "success",
            timestamp: Date(),
            errorSummary: nil,
            buildTime: 2.5,
            gitHash: "abc123",
            startTime: nil
        )
        
        let targetState = TargetState(
            target: "main-app",
            isActive: true,
            lastHeartbeat: Date(),
            lastBuild: buildInfo,
            icon: nil
        )
        
        project.targets["main-app"] = targetState
        
        // Create submenu for target
        let targetMenuItem = NSMenuItem()
        targetMenuItem.title = "main-app"
        
        if let build = targetState.lastBuild {
            let statusText = build.status.capitalized
            let timeText = build.buildTime.map { String(format: "%.1fs", $0) } ?? "—"
            targetMenuItem.toolTip = "\(statusText) • \(timeText)"
        }
        
        #expect(targetMenuItem.title == "main-app")
        #expect(targetMenuItem.toolTip?.contains("Success") == true)
        #expect(targetMenuItem.toolTip?.contains("2.5s") == true)
    }
    
    @Test("Menu item hierarchy for multiple targets")
    func testMenuItemHierarchyForMultipleTargets() {
        var project = Project(path: "/test", name: "MultiTarget", hash: "hash")
        
        let targets = ["app", "tests", "lib"]
        let statuses = ["success", "failed", "building"]
        
        for (index, target) in targets.enumerated() {
            let buildInfo = BuildInfo(
                status: statuses[index],
                timestamp: Date(),
                errorSummary: statuses[index] == "failed" ? "Build error" : nil,
                buildTime: Double(index + 1) * 1.5,
                gitHash: "hash\(index)",
                startTime: statuses[index] == "building" ? Date().addingTimeInterval(-30) : nil
            )
            
            let targetState = TargetState(
                target: target,
                isActive: true,
                lastHeartbeat: Date(),
                lastBuild: buildInfo,
                icon: nil
            )
            
            project.targets[target] = targetState
        }
        
        // Test that we have all targets
        #expect(project.targets.count == 3)
        
        // Test sorted targets maintains order
        let sortedTargets = project.sortedTargets
        #expect(sortedTargets.count == 3)
        #expect(sortedTargets[0].key == "app")
        #expect(sortedTargets[1].key == "lib") 
        #expect(sortedTargets[2].key == "tests")
        
        // Test overall status (should be failed due to tests)
        #expect(project.overallStatus == .failed)
    }
    
    // MARK: - Menu State Updates Tests
    
    @Test("Menu update on project changes")
    func testMenuUpdateOnProjectChanges() {
        let project1 = Project(path: "/test1", name: "Project1", hash: "hash1")
        let project2 = Project(path: "/test2", name: "Project2", hash: "hash2")
        
        var projects = [project1, project2]
        
        // Simulate adding a new project
        let project3 = Project(path: "/test3", name: "Project3", hash: "hash3")
        projects.append(project3)
        
        #expect(projects.count == 3)
        
        // Simulate removing a project
        projects.removeAll { $0.id == project2.id }
        
        #expect(projects.count == 2)
        #expect(projects.contains { $0.name == "Project1" })
        #expect(projects.contains { $0.name == "Project3" })
        #expect(!projects.contains { $0.name == "Project2" })
    }
    
    @Test("Menu item state for inactive projects")
    func testMenuItemStateForInactiveProjects() {
        var project = Project(path: "/test", name: "InactiveProject", hash: "hash")
        
        // Create stale target (heartbeat > 5 minutes ago)
        let staleHeartbeat = Date().addingTimeInterval(-400) // 6 minutes 40 seconds ago
        let staleTarget = TargetState(
            target: "stale-app",
            isActive: false,
            lastHeartbeat: staleHeartbeat,
            lastBuild: nil,
            icon: nil
        )
        
        project.targets["stale-app"] = staleTarget
        
        #expect(staleTarget.isStale == true)
        #expect(staleTarget.isActive == false)
        
        // Menu item for inactive project should be visually distinct
        let menuItem = NSMenuItem()
        menuItem.title = project.name
        
        // Inactive projects might be shown differently (grayed out, etc.)
        if !staleTarget.isActive || staleTarget.isStale {
            menuItem.isEnabled = false
        }
        
        #expect(menuItem.isEnabled == false)
    }
    
    // MARK: - Menu Action Tests
    
    @Test("Menu item action configuration")
    func testMenuItemActionConfiguration() {
        let project = Project(path: "/test/project", name: "ActionTest", hash: "hash")
        
        // Create menu items with different actions
        let openProjectItem = NSMenuItem()
        openProjectItem.title = "Open Project Folder"
        openProjectItem.tag = 1001 // Custom tag for identification
        
        let showLogsItem = NSMenuItem()
        showLogsItem.title = "Show Build Logs"
        showLogsItem.tag = 1002
        
        let cleanProjectItem = NSMenuItem()
        cleanProjectItem.title = "Clean Project"
        cleanProjectItem.tag = 1003
        
        #expect(openProjectItem.tag == 1001)
        #expect(showLogsItem.tag == 1002)
        #expect(cleanProjectItem.tag == 1003)
        
        // Test that titles are appropriate
        #expect(openProjectItem.title.contains("Open"))
        #expect(showLogsItem.title.contains("Logs"))
        #expect(cleanProjectItem.title.contains("Clean"))
    }
    
    @Test("Menu separator creation")
    func testMenuSeparatorCreation() {
        let separator = NSMenuItem.separator()
        
        #expect(separator.isSeparatorItem == true)
        #expect(separator.title == "")
        #expect(separator.isEnabled == false)
    }
    
    // MARK: - Menu Item Accessibility Tests
    
    @Test("Menu item accessibility configuration")
    func testMenuItemAccessibilityConfiguration() {
        let project = Project(path: "/test", name: "AccessibilityTest", hash: "hash")
        
        let menuItem = NSMenuItem()
        menuItem.title = project.name
        menuItem.toolTip = "Project at \(project.path)"
        
        // Set accessibility properties  
        menuItem.setAccessibilityLabel("Project \(project.name)")
        menuItem.setAccessibilityHelp("Poltergeist project monitoring")
        
        #expect(menuItem.accessibilityLabel() == "Project AccessibilityTest")
        #expect(menuItem.accessibilityHelp() == "Poltergeist project monitoring")
        #expect(menuItem.toolTip?.contains("/test") == true)
    }
    
    // MARK: - Build Progress Display Tests
    
    @Test("Build progress indicator in menu")
    func testBuildProgressIndicatorInMenu() throws {
        let buildInfo = BuildInfo(
            status: "building",
            timestamp: Date(),
            errorSummary: nil,
            buildTime: nil,
            gitHash: nil,
            startTime: Date().addingTimeInterval(-15) // Started 15 seconds ago
        )
        
        #expect(buildInfo.isBuilding == true)
        
        let progress = buildInfo.buildProgress
        let progressRequired = try #require(progress)
        
        #expect(progressRequired > 0.0)
        #expect(progressRequired <= 0.95) // Capped at 95%
        
        // Test progress display formatting
        let progressPercentage = Int(progressRequired * 100)
        let progressText = "\(progressPercentage)%"
        
        #expect(progressText.contains("%"))
        #expect(progressPercentage >= 0)
        #expect(progressPercentage <= 95)
    }
    
    @Test("Build time formatting for menu display")
    func testBuildTimeFormattingForMenuDisplay() {
        let buildTimes: [Double?] = [nil, 0.5, 1.2, 5.7, 30.8, 125.3]
        let expectedFormats = ["—", "0.5s", "1.2s", "5.7s", "30.8s", "125.3s"]
        
        for (buildTime, expectedFormat) in zip(buildTimes, expectedFormats) {
            let formattedTime: String
            if let time = buildTime {
                formattedTime = String(format: "%.1fs", time)
            } else {
                formattedTime = "—"
            }
            
            #expect(formattedTime == expectedFormat)
        }
    }
}

// MARK: - Status Bar Controller Integration Tests
@Suite("Status Bar Controller Integration", .tags(.features, .integration))
@MainActor
final class StatusBarControllerIntegrationTests {
    
    @Test("Status bar item creation")
    func testStatusBarItemCreation() {
        // Test that we can create a status bar item
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        #expect(statusItem != nil)
        #expect(statusItem.length == NSStatusItem.variableLength)
        
        // Configure basic properties
        statusItem.button?.title = "Poltergeist"
        statusItem.button?.toolTip = "Poltergeist Build Monitor"
        
        #expect(statusItem.button?.title == "Poltergeist")
        #expect(statusItem.button?.toolTip == "Poltergeist Build Monitor")
        
        // Clean up
        NSStatusBar.system.removeStatusItem(statusItem)
    }
    
    @Test("Status bar menu attachment")
    func testStatusBarMenuAttachment() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let menu = NSMenu()
        
        menu.title = "Poltergeist"
        menu.addItem(NSMenuItem(title: "Test Item", action: nil, keyEquivalent: ""))
        
        statusItem.menu = menu
        
        #expect(statusItem.menu === menu)
        #expect(statusItem.menu?.title == "Poltergeist")
        #expect(statusItem.menu?.items.count == 1)
        
        // Clean up
        NSStatusBar.system.removeStatusItem(statusItem)
    }
    
    @Test("Status bar icon updates")
    func testStatusBarIconUpdates() {
        let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        
        // Test different icon states
        let statuses: [Project.BuildStatus] = [.idle, .building, .success, .failed]
        
        for status in statuses {
            let iconName = status.icon
            let color = status.color
            
            // Create image with system symbol
            if let image = NSImage(systemSymbolName: iconName, accessibilityDescription: nil) {
                // Tint the image with the status color
                image.isTemplate = true
                statusItem.button?.image = image
                statusItem.button?.contentTintColor = color
                
                #expect(statusItem.button?.image === image)
                #expect(statusItem.button?.contentTintColor == color)
            }
        }
        
        // Clean up
        NSStatusBar.system.removeStatusItem(statusItem)
    }
}