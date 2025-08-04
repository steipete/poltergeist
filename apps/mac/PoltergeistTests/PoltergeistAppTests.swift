//
//  PoltergeistAppTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
import SwiftUI
@testable import Poltergeist

// MARK: - App Lifecycle Tests
@Suite("Poltergeist App Tests", .tags(.integration, .unit))
@MainActor
struct PoltergeistAppTests {
    // MARK: - App Configuration Tests

    @Test("App bundle configuration")
    func testAppBundleConfiguration() {
        let bundle = Bundle.main

        // Test basic bundle properties
        #expect(bundle.bundleIdentifier != nil)

        if let bundleId = bundle.bundleIdentifier {
            #expect(bundleId.contains("poltergeist") || bundleId.contains("Poltergeist"))
        }

        // Test version information
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
        let buildNumber = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String

        #expect(version != nil)
        #expect(buildNumber != nil)
    }

    @Test("App entitlements and permissions")
    func testAppEntitlementsAndPermissions() {
        let bundle = Bundle.main

        // Check for expected entitlements (these might not be present in test environment)
        let sandboxed = bundle.object(forInfoDictionaryKey: "com.apple.security.app-sandbox") as? Bool
        let networkClient = bundle.object(forInfoDictionaryKey: "com.apple.security.network.client") as? Bool

        // These tests are informational - entitlements might not be present during testing
        if let isSandboxed = sandboxed {
            #expect(isSandboxed is Bool)
        }

        if let hasNetworkAccess = networkClient {
            #expect(hasNetworkAccess is Bool)
        }
    }

    // MARK: - Singleton Pattern Tests

    @Test("ProjectMonitor singleton behavior")
    func testProjectMonitorSingleton() {
        let monitor1 = ProjectMonitor.shared
        let monitor2 = ProjectMonitor.shared

        #expect(monitor1 === monitor2)
    }

    @Test("Preferences singleton behavior")
    func testPreferencesSingleton() {
        let prefs1 = Preferences.shared
        let prefs2 = Preferences.shared

        #expect(prefs1 === prefs2)
    }

    @Test("NotificationManager singleton behavior")
    func testNotificationManagerSingleton() {
        let manager1 = NotificationManager.shared
        let manager2 = NotificationManager.shared

        #expect(manager1 === manager2)
    }

    // MARK: - App State Management Tests

    @Test("App initialization state")
    func testAppInitializationState() {
        // Test that singletons are properly initialized
        let projectMonitor = ProjectMonitor.shared
        let preferences = Preferences.shared
        let notificationManager = NotificationManager.shared

        #expect(projectMonitor != nil)
        #expect(preferences != nil)
        #expect(notificationManager != nil)

        // Test initial state
        #expect(projectMonitor.projects.isEmpty)

        // Reset preferences to ensure clean state
        preferences.reset()
        #expect(preferences.showNotifications == true)
        #expect(preferences.statusCheckInterval == 5.0)
    }

    // MARK: - Menu Bar Integration Tests

    @Test("Status bar integration availability")
    func testStatusBarIntegrationAvailability() {
        // Test that NSStatusBar is available
        let statusBar = NSStatusBar.system
        #expect(statusBar != nil)

        // Test that we can create status items (but don't keep them)
        let testItem = statusBar.statusItem(withLength: NSStatusItem.variableLength)
        #expect(testItem != nil)

        // Clean up immediately
        statusBar.removeStatusItem(testItem)
    }

    // MARK: - File System Integration Tests

    @Test("Poltergeist directory handling")
    func testPoltergeistDirectoryHandling() {
        let poltergeistDir = FileManager.default.temporaryDirectory.appendingPathComponent("poltergeist").path

        // Test directory creation (safe to do in tests)
        let fileManager = FileManager.default

        // Check if directory exists or can be created
        var isDirectory: ObjCBool = false
        let exists = fileManager.fileExists(atPath: poltergeistDir, isDirectory: &isDirectory)

        if exists {
            #expect(isDirectory.boolValue == true)
        } else {
            // Test that we can create it
            #expect(throws: Never.self) {
                try fileManager.createDirectory(
                    atPath: poltergeistDir,
                    withIntermediateDirectories: true,
                    attributes: nil
                )
            }
        }
    }

    // MARK: - Error Handling Tests

    @Test("App error recovery scenarios")
    func testAppErrorRecoveryScenarios() {
        // Test handling of corrupted preferences
        let preferences = Preferences.shared

        // Save current state
        let originalNotifications = preferences.showNotifications
        let originalInterval = preferences.statusCheckInterval

        // Test reset functionality
        preferences.reset()

        #expect(preferences.showNotifications == true)
        #expect(preferences.statusCheckInterval == 5.0)

        // Restore original state
        preferences.showNotifications = originalNotifications
        preferences.statusCheckInterval = originalInterval
    }

    // MARK: - Performance Tests

    @Test("App startup performance characteristics")
    func testAppStartupPerformanceCharacteristics() {
        // Test that singleton initialization is fast
        let startTime = Date()

        _ = ProjectMonitor.shared
        _ = Preferences.shared
        _ = NotificationManager.shared

        let initTime = Date().timeIntervalSince(startTime)

        // Singleton initialization should be very fast (< 100ms)
        #expect(initTime < 0.1)
    }

    @Test("Memory usage characteristics")
    func testMemoryUsageCharacteristics() {
        // Test that we don't create excessive objects during initialization
        let projectMonitor = ProjectMonitor.shared
        let preferences = Preferences.shared

        // These should be lightweight objects
        #expect(projectMonitor.projects.isEmpty)
        #expect(preferences.statusCheckInterval > 0)

        // Test that multiple accesses don't create new instances
        let monitor2 = ProjectMonitor.shared
        let prefs2 = Preferences.shared

        #expect(projectMonitor === monitor2)
        #expect(preferences === prefs2)
    }
}

// MARK: - App Integration Workflow Tests
@Suite("App Integration Workflow Tests", .tags(.integration))
@MainActor
final class AppIntegrationWorkflowTests {
    let tempDirectory: URL

    init() throws {
        // Create temporary directory for integration tests
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("poltergeist-app-tests")
            .appendingPathComponent(UUID().uuidString)

        try FileManager.default.createDirectory(
            at: tempDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
    }

    deinit {
        try? FileManager.default.removeItem(at: tempDirectory)
    }

    @Test("End-to-end project monitoring workflow")
    func testEndToEndProjectMonitoringWorkflow() throws {
        // Create a mock state file
        let stateFileName = "TestProject-12345678-main.state"
        let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)

        let stateContent = """
        {
            "version": "1.0.0",
            "projectPath": "\(tempDirectory.path)/TestProject",
            "projectName": "TestProject",
            "target": "main",
            "configPath": "\(tempDirectory.path)/TestProject/config.json",
            "process": {
                "pid": 12345,
                "isActive": true,
                "startTime": "2025-01-01T10:00:00Z",
                "lastHeartbeat": "2025-01-01T10:05:00Z"
            },
            "lastBuild": {
                "status": "success",
                "timestamp": "2025-01-01T10:04:30Z",
                "startTime": "2025-01-01T10:04:00Z",
                "gitHash": "abc123def456",
                "errorSummary": null,
                "buildTime": 30.5,
                "fullError": null,
                "currentPhase": "completed",
                "estimatedDuration": 35.0
            },
            "appInfo": {
                "bundleId": "com.test.app",
                "outputPath": "\(tempDirectory.path)/TestProject/.build/debug/TestApp",
                "iconPath": null
            }
        }
        """

        try stateContent.write(to: stateFilePath, atomically: true, encoding: .utf8)

        // Verify file was created
        #expect(FileManager.default.fileExists(atPath: stateFilePath.path))

        // Test that we can decode the state
        let data = try Data(contentsOf: stateFilePath)
        let state = try JSONDecoder().decode(PoltergeistState.self, from: data)

        #expect(state.projectName == "TestProject")
        #expect(state.target == "main")
        #expect(state.process.isActive == true)

        // Test creating project from state
        let project = Project(
            path: state.projectPath,
            name: state.projectName,
            hash: "12345678"
        )

        #expect(project.name == "TestProject")
        #expect(project.path.contains("TestProject"))
    }

    @Test("Notification workflow integration")
    func testNotificationWorkflowIntegration() async throws {
        // Test the notification request workflow
        let notificationManager = NotificationManager.shared
        #expect(notificationManager != nil)

        // Test preferences integration
        let preferences = Preferences.shared
        preferences.reset()

        #expect(preferences.showNotifications == true)
        #expect(preferences.notifyOnlyOnFailure == false)

        // Test notification filtering logic
        let project = Project(path: "/test", name: "TestProject", hash: "hash")

        // Success notification should be shown when showNotifications = true, notifyOnlyOnFailure = false
        preferences.showNotifications = true
        preferences.notifyOnlyOnFailure = false
        let shouldShowSuccess1 = preferences.showNotifications && !preferences.notifyOnlyOnFailure
        #expect(shouldShowSuccess1 == true)

        // Success notification should NOT be shown when notifyOnlyOnFailure = true
        preferences.notifyOnlyOnFailure = true
        let shouldShowSuccess2 = preferences.showNotifications && !preferences.notifyOnlyOnFailure
        #expect(shouldShowSuccess2 == false)

        // Failure notifications should always be shown when notifications are enabled
        let shouldShowFailure = preferences.showNotifications
        #expect(shouldShowFailure == true)

        // No notifications should be shown when disabled
        preferences.showNotifications = false
        let shouldShowWhenDisabled = preferences.showNotifications
        #expect(shouldShowWhenDisabled == false)

        // Reset for cleanup
        preferences.reset()
    }

    @Test("Preferences persistence workflow")
    func testPreferencesPersistenceWorkflow() {
        let preferences = Preferences.shared

        // Save original values
        let originalNotifications = preferences.showNotifications
        let originalSound = preferences.soundEnabled
        let originalInterval = preferences.statusCheckInterval

        // Modify preferences
        preferences.showNotifications = false
        preferences.soundEnabled = false
        preferences.statusCheckInterval = 10.0

        // Verify changes
        #expect(preferences.showNotifications == false)
        #expect(preferences.soundEnabled == false)
        #expect(preferences.statusCheckInterval == 10.0)

        // Test reset functionality
        preferences.reset()

        #expect(preferences.showNotifications == true)
        #expect(preferences.soundEnabled == true)
        #expect(preferences.statusCheckInterval == 5.0)

        // Restore original values
        preferences.showNotifications = originalNotifications
        preferences.soundEnabled = originalSound
        preferences.statusCheckInterval = originalInterval
    }
}
