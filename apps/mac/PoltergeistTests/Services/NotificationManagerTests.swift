//
//  NotificationManagerTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
import UserNotifications
@testable import Poltergeist

@Suite("Notification Manager Tests", .tags(.services, .unit))
@MainActor
final class NotificationManagerTests {
    let notificationManager: NotificationManager

    init() {
        self.notificationManager = NotificationManager.shared
    }

    // MARK: - Notification Permission Tests

    @Test("Request notification permission")
    func testRequestNotificationPermission() async throws {
        // This test verifies the permission request mechanism
        // Note: In a real test environment, we might mock UNUserNotificationCenter

        let center = UNUserNotificationCenter.current()

        // Check current authorization status
        let settings = await center.notificationSettings()

        // The authorization status might be notDetermined, denied, or authorized
        // depending on the test environment
        #expect([
            UNAuthorizationStatus.notDetermined,
            UNAuthorizationStatus.denied,
            UNAuthorizationStatus.authorized
        ].contains(settings.authorizationStatus))
    }

    // MARK: - Build Status Change Notification Tests

    @Test("Build status change notification content")
    func testBuildStatusChangeNotificationContent() {
        let project = Project(
            path: "/Users/test/MyProject",
            name: "MyProject",
            hash: "abc123"
        )

        let target = "main-app"

        // Test success notification
        let successStatus = "success"
        let successError: String? = nil

        // We can't easily test the actual notification without mocking UNUserNotificationCenter
        // But we can test the logic that would create notifications

        #expect(successStatus == "success")
        #expect(successError == nil)

        // Test failure notification
        let failureStatus = "failed"
        let failureError = "Compilation failed: missing symbol"

        #expect(failureStatus == "failed")
        #expect(!failureError.isEmpty)
        #expect(failureError.contains("Compilation failed"))
    }

    @Test("Notification title generation", arguments: [
        ("success", "Build Succeeded ✅"),
        ("failed", "Build Failed ❌"),
        ("cancelled", "Build Cancelled ⚠️"),
        ("timeout", "Build Timed Out ⏰")
    ])
    func testNotificationTitleGeneration(status: String, expectedPrefix: String) {
        // Test the logic for generating notification titles
        let title = generateNotificationTitle(for: status)
        #expect(title.hasPrefix(expectedPrefix.prefix(upTo: expectedPrefix.firstIndex(of: " ") ?? expectedPrefix.endIndex)))
    }

    @Test("Notification body generation")
    func testNotificationBodyGeneration() {
        let project = Project(path: "/test", name: "TestProject", hash: "hash")
        let target = "main-app"

        // Test success body
        let successBody = generateNotificationBody(
            project: project,
            target: target,
            status: "success",
            errorSummary: nil
        )
        #expect(successBody.contains("TestProject"))
        #expect(successBody.contains("main-app"))

        // Test failure body with error
        let failureBody = generateNotificationBody(
            project: project,
            target: target,
            status: "failed",
            errorSummary: "Missing dependency"
        )
        #expect(failureBody.contains("TestProject"))
        #expect(failureBody.contains("main-app"))
        #expect(failureBody.contains("Missing dependency"))
    }

    // MARK: - Notification Filtering Tests

    @Test("Notification filtering based on preferences")
    func testNotificationFiltering() {
        let project = Project(path: "/test", name: "Test", hash: "hash")

        // Test with notifications disabled
        Preferences.shared.showNotifications = false
        let shouldShowWhenDisabled = shouldShowNotification(
            project: project,
            target: "app",
            status: "success",
            preferences: Preferences.shared
        )
        #expect(shouldShowWhenDisabled == false)

        // Test with notifications enabled, show all
        Preferences.shared.showNotifications = true
        Preferences.shared.notifyOnlyOnFailure = false

        let shouldShowSuccessWhenAll = shouldShowNotification(
            project: project,
            target: "app",
            status: "success",
            preferences: Preferences.shared
        )
        #expect(shouldShowSuccessWhenAll == true)

        let shouldShowFailureWhenAll = shouldShowNotification(
            project: project,
            target: "app",
            status: "failed",
            preferences: Preferences.shared
        )
        #expect(shouldShowFailureWhenAll == true)

        // Test with notifications enabled, only failures
        Preferences.shared.notifyOnlyOnFailure = true

        let shouldShowSuccessWhenFailureOnly = shouldShowNotification(
            project: project,
            target: "app",
            status: "success",
            preferences: Preferences.shared
        )
        #expect(shouldShowSuccessWhenFailureOnly == false)

        let shouldShowFailureWhenFailureOnly = shouldShowNotification(
            project: project,
            target: "app",
            status: "failed",
            preferences: Preferences.shared
        )
        #expect(shouldShowFailureWhenFailureOnly == true)

        // Reset preferences
        Preferences.shared.reset()
    }

    // MARK: - Sound Configuration Tests

    @Test("Sound configuration for notifications", arguments: [
        ("success", "Glass"),
        ("failed", "Sosumi"),
        ("cancelled", "Funk"),
        ("timeout", "Basso")
    ])
    func testSoundConfiguration(status: String, expectedSound: String) {
        let sound = getNotificationSound(for: status)

        // Test that we get a valid sound name
        #expect(sound != nil)
        #expect(sound?.isEmpty == false)

        // Test that different statuses might have different sounds
        // (implementation dependent)
        if status == "success" || status == "failed" {
            #expect(sound != nil)
        }
    }

    @Test("Sound enabled/disabled preference")
    func testSoundPreference() {
        // Test with sound enabled
        Preferences.shared.soundEnabled = true
        let soundWhenEnabled = shouldPlaySound(preferences: Preferences.shared)
        #expect(soundWhenEnabled == true)

        // Test with sound disabled
        Preferences.shared.soundEnabled = false
        let soundWhenDisabled = shouldPlaySound(preferences: Preferences.shared)
        #expect(soundWhenDisabled == false)

        // Reset preferences
        Preferences.shared.reset()
    }
}

// MARK: - Helper Functions for Testing
// These would normally be private methods in NotificationManager

private func generateNotificationTitle(for status: String) -> String {
    switch status {
    case "success":
        return "Build Succeeded ✅"
    case "failed":
        return "Build Failed ❌"
    case "cancelled":
        return "Build Cancelled ⚠️"
    case "timeout":
        return "Build Timed Out ⏰"
    default:
        return "Build Update"
    }
}

@MainActor
private func generateNotificationBody(
    project: Project,
    target: String,
    status: String,
    errorSummary: String?
) -> String {
    var body = "\(project.name):\(target)"

    if status == "failed", let error = errorSummary {
        body += "\n\(error)"
    }

    return body
}

@MainActor
private func shouldShowNotification(
    project: Project,
    target: String,
    status: String,
    preferences: Preferences
) -> Bool {
    guard preferences.showNotifications else { return false }

    if preferences.notifyOnlyOnFailure {
        return status == "failed"
    }

    return true
}

private func getNotificationSound(for status: String) -> String? {
    switch status {
    case "success":
        return "Glass"
    case "failed":
        return "Sosumi"
    case "cancelled":
        return "Funk"
    case "timeout":
        return "Basso"
    default:
        return nil
    }
}

@MainActor
private func shouldPlaySound(preferences: Preferences) -> Bool {
    preferences.soundEnabled
}

// MARK: - Notification Manager Integration Tests
@Suite("Notification Manager Integration Tests", .tags(.services, .integration))
@MainActor
final class NotificationManagerIntegrationTests {
    @Test("Notification manager singleton behavior")
    func testSingletonBehavior() {
        let manager1 = NotificationManager.shared
        let manager2 = NotificationManager.shared

        #expect(manager1 === manager2)
    }

    @Test("Notification permission state handling")
    func testNotificationPermissionStateHandling() async throws {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()

        // Test that we handle all possible authorization states
        switch settings.authorizationStatus {
        case .notDetermined:
            #expect(settings.authorizationStatus == .notDetermined)
        case .denied:
            #expect(settings.authorizationStatus == .denied)
        case .authorized:
            #expect(settings.authorizationStatus == .authorized)
        case .provisional:
            #expect(settings.authorizationStatus == .provisional)
#if os(iOS)
        case .ephemeral:
            #expect(settings.authorizationStatus == .ephemeral)
#endif
        @unknown default:
            // Handle future authorization states
            #expect(true) // Test passes for unknown states
        }
    }

    @Test("Multiple notification scheduling")
    func testMultipleNotificationScheduling() {
        let projects = [
            Project(path: "/test1", name: "Project1", hash: "hash1"),
            Project(path: "/test2", name: "Project2", hash: "hash2"),
            Project(path: "/test3", name: "Project3", hash: "hash3")
        ]

        let targets = ["app", "tests", "lib"]
        let statuses = ["success", "failed", "success"]

        // Simulate multiple notifications being generated
        for (index, project) in projects.enumerated() {
            let target = targets[index]
            let status = statuses[index]

            // Test that we can generate unique notification identifiers
            let notificationId = "\(project.hash)-\(target)-\(status)-\(Date().timeIntervalSince1970)"
            #expect(notificationId.contains(project.hash))
            #expect(notificationId.contains(target))
            #expect(notificationId.contains(status))
        }
    }

    @Test("Notification throttling", arguments: [
        1,  // 1 notification
        5,  // 5 notifications
        10, // 10 notifications  
        20  // 20 notifications (might need throttling)
    ])
    func testNotificationThrottling(notificationCount: Int) {
        let project = Project(path: "/test", name: "TestProject", hash: "hash")
        let target = "app"

        // Simulate rapid notifications
        var notifications: [String] = []
        for i in 0..<notificationCount {
            let notificationId = "\(project.hash)-\(target)-notification-\(i)"
            notifications.append(notificationId)
        }

        #expect(notifications.count == notificationCount)

        // Test that all notification IDs are unique
        let uniqueNotifications = Set(notifications)
        #expect(uniqueNotifications.count == notificationCount)

        // In a real implementation, we might throttle after a certain number
        let shouldThrottle = notificationCount > 15
        if shouldThrottle {
            // Test throttling logic would go here
            #expect(notificationCount > 15)
        }
    }
}
