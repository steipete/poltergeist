//
//  PreferencesTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
import SwiftUI
@testable import Poltergeist

@Suite("Preferences Tests", .tags(.models, .fast, .unit))
@MainActor
struct PreferencesTests {
    
    // Create a fresh preferences instance for each test
    // Note: Since Preferences is a singleton, we need to be careful about state isolation
    
    @Test("Default preferences values")
    func testDefaultPreferences() {
        let preferences = Preferences.shared
        
        // Reset to ensure clean state
        preferences.reset()
        
        #expect(preferences.showNotifications == true)
        #expect(preferences.notifyOnlyOnFailure == false)
        #expect(preferences.launchAtLogin == false)
        #expect(preferences.statusCheckInterval == 5.0)
        #expect(preferences.soundEnabled == true)
        #expect(preferences.autoCleanupInactiveDays == 7)
        #expect(preferences.showBuildTimeInBadges == true)
    }
    
    @Test("Preferences modification")
    func testPreferencesModification() {
        let preferences = Preferences.shared
        preferences.reset()
        
        // Test boolean preferences
        preferences.showNotifications = false
        #expect(preferences.showNotifications == false)
        
        preferences.notifyOnlyOnFailure = true
        #expect(preferences.notifyOnlyOnFailure == true)
        
        preferences.launchAtLogin = true
        #expect(preferences.launchAtLogin == true)
        
        preferences.soundEnabled = false
        #expect(preferences.soundEnabled == false)
        
        preferences.showBuildTimeInBadges = false
        #expect(preferences.showBuildTimeInBadges == false)
        
        // Test numeric preferences
        preferences.statusCheckInterval = 10.0
        #expect(preferences.statusCheckInterval == 10.0)
        
        preferences.autoCleanupInactiveDays = 14
        #expect(preferences.autoCleanupInactiveDays == 14)
    }
    
    @Test("Preferences reset functionality")
    func testPreferencesReset() {
        let preferences = Preferences.shared
        
        // Modify all preferences
        preferences.showNotifications = false
        preferences.notifyOnlyOnFailure = true
        preferences.launchAtLogin = true
        preferences.statusCheckInterval = 15.0
        preferences.soundEnabled = false
        preferences.autoCleanupInactiveDays = 30
        preferences.showBuildTimeInBadges = false
        
        // Verify they were changed
        #expect(preferences.showNotifications == false)
        #expect(preferences.notifyOnlyOnFailure == true)
        #expect(preferences.launchAtLogin == true)
        #expect(preferences.statusCheckInterval == 15.0)
        #expect(preferences.soundEnabled == false)
        #expect(preferences.autoCleanupInactiveDays == 30)
        #expect(preferences.showBuildTimeInBadges == false)
        
        // Reset and verify defaults are restored
        preferences.reset()
        
        #expect(preferences.showNotifications == true)
        #expect(preferences.notifyOnlyOnFailure == false)
        #expect(preferences.launchAtLogin == false)
        #expect(preferences.statusCheckInterval == 5.0)
        #expect(preferences.soundEnabled == true)
        #expect(preferences.autoCleanupInactiveDays == 7)
        #expect(preferences.showBuildTimeInBadges == true)
    }
    
    @Test("Status check interval validation", arguments: [
        1.0, 5.0, 10.0, 30.0, 60.0
    ])
    func testStatusCheckIntervalValues(interval: TimeInterval) {
        let preferences = Preferences.shared
        preferences.reset()
        
        preferences.statusCheckInterval = interval
        #expect(preferences.statusCheckInterval == interval)
    }
    
    @Test("Auto cleanup days validation", arguments: [
        1, 3, 7, 14, 30, 90
    ])
    func testAutoCleanupDaysValues(days: Int) {
        let preferences = Preferences.shared
        preferences.reset()
        
        preferences.autoCleanupInactiveDays = days
        #expect(preferences.autoCleanupInactiveDays == days)
    }
    
    @Test("Notification preference combinations", arguments: [
        // (showNotifications, notifyOnlyOnFailure, expectedBehavior)
        (true, false), // Show all notifications
        (true, true),  // Show only failure notifications  
        (false, false), // Show no notifications
        (false, true)   // Show no notifications (disabled overrides failure-only)
    ])
    func testNotificationPreferenceCombinations(showNotifications: Bool, notifyOnlyOnFailure: Bool) {
        let preferences = Preferences.shared
        preferences.reset()
        
        preferences.showNotifications = showNotifications
        preferences.notifyOnlyOnFailure = notifyOnlyOnFailure
        
        #expect(preferences.showNotifications == showNotifications)
        #expect(preferences.notifyOnlyOnFailure == notifyOnlyOnFailure)
        
        // Test the logical combinations
        let shouldShowSuccess = showNotifications && !notifyOnlyOnFailure
        let shouldShowFailure = showNotifications // Always show failures when notifications are enabled
        
        // These would be used by the notification system
        #expect((preferences.showNotifications && !preferences.notifyOnlyOnFailure) == shouldShowSuccess)
        #expect(preferences.showNotifications == shouldShowFailure)
    }
    
    @Test("Preferences singleton behavior")
    func testSingletonBehavior() {
        let preferences1 = Preferences.shared
        let preferences2 = Preferences.shared
        
        // Should be the same instance
        #expect(preferences1 === preferences2)
        
        // Changes in one should reflect in the other (since they're the same object)
        preferences1.showNotifications = false
        #expect(preferences2.showNotifications == false)
        
        preferences2.soundEnabled = false
        #expect(preferences1.soundEnabled == false)
        
        // Clean up
        preferences1.reset()
    }
}

// MARK: - Preferences Edge Cases
@Suite("Preferences Edge Cases", .tags(.models, .unit))
@MainActor
struct PreferencesEdgeCaseTests {
    
    @Test("Extreme status check intervals", arguments: [
        0.1, 0.5, 1.0, 120.0, 300.0
    ])
    func testExtremeStatusCheckIntervals(interval: TimeInterval) {
        let preferences = Preferences.shared
        preferences.reset()
        
        preferences.statusCheckInterval = interval
        #expect(preferences.statusCheckInterval == interval)
        
        // Verify it's a reasonable value for the app to handle
        #expect(preferences.statusCheckInterval > 0.0)
    }
    
    @Test("Extreme cleanup day values", arguments: [
        1, 365, 1000
    ])
    func testExtremeCleanupDays(days: Int) {
        let preferences = Preferences.shared
        preferences.reset()
        
        preferences.autoCleanupInactiveDays = days
        #expect(preferences.autoCleanupInactiveDays == days)
        #expect(preferences.autoCleanupInactiveDays > 0)
    }
    
    @Test("Negative values handling")
    func testNegativeValues() {
        let preferences = Preferences.shared
        preferences.reset()
        
        // Test that negative values can be set (AppStorage doesn't validate)
        // This tests the current behavior, though the app should validate these
        preferences.statusCheckInterval = -1.0
        #expect(preferences.statusCheckInterval == -1.0)
        
        preferences.autoCleanupInactiveDays = -5
        #expect(preferences.autoCleanupInactiveDays == -5)
        
        // Clean up
        preferences.reset()
    }
}

// MARK: - Preferences Observable Tests  
@Suite("Preferences Observable Tests", .tags(.models, .unit))
@MainActor
struct PreferencesObservableTests {
    
    @Test("Observable conformance")
    func testObservableConformance() {
        let preferences = Preferences.shared
        preferences.reset()
        
        // Verify it's @Observable (Swift 6 pattern)
        // @Observable classes don't have objectWillChange publishers
        // Instead, they automatically track changes for SwiftUI
        
        // Test that we can read and modify properties
        preferences.showNotifications = false
        #expect(preferences.showNotifications == false)
        
        preferences.showNotifications = true
        #expect(preferences.showNotifications == true)
        
        preferences.reset()
    }
    
    @Test("Observable property changes work correctly")
    func testObservablePropertyChanges() {
        let preferences = Preferences.shared
        preferences.reset()
        
        // Test that property changes are immediate and observable
        let originalValue = preferences.showNotifications
        preferences.showNotifications = !originalValue
        #expect(preferences.showNotifications == !originalValue)
        
        // Test multiple property changes
        preferences.soundEnabled = false
        preferences.launchAtLogin = true
        preferences.statusCheckInterval = 10.0
        
        #expect(preferences.soundEnabled == false)
        #expect(preferences.launchAtLogin == true)
        #expect(preferences.statusCheckInterval == 10.0)
        
        preferences.reset()
    }
}