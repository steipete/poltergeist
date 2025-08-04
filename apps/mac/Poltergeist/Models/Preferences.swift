import Foundation
import SwiftUI

//
//  Preferences.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

/// Modern preferences using @Observable with proper @AppStorage integration
@MainActor
@Observable
final class Preferences {
    static let shared = Preferences()

    // @Observable doesn't work directly with @AppStorage, so we use computed properties
    var showNotifications: Bool {
        get { UserDefaults.standard.object(forKey: "showNotifications") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "showNotifications") }
    }
    
    var notifyOnlyOnFailure: Bool {
        get { UserDefaults.standard.object(forKey: "notifyOnlyOnFailure") as? Bool ?? false }
        set { UserDefaults.standard.set(newValue, forKey: "notifyOnlyOnFailure") }
    }
    
    var launchAtLogin: Bool {
        get { UserDefaults.standard.object(forKey: "launchAtLogin") as? Bool ?? false }
        set { UserDefaults.standard.set(newValue, forKey: "launchAtLogin") }
    }
    
    var statusCheckInterval: TimeInterval {
        get { 
            let value = UserDefaults.standard.object(forKey: "statusCheckInterval") as? Double
            return value ?? 5.0
        }
        set { UserDefaults.standard.set(newValue, forKey: "statusCheckInterval") }
    }
    
    var soundEnabled: Bool {
        get { UserDefaults.standard.object(forKey: "soundEnabled") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "soundEnabled") }
    }
    
    var autoCleanupInactiveDays: Int {
        get { UserDefaults.standard.object(forKey: "autoCleanupInactiveDays") as? Int ?? 7 }
        set { UserDefaults.standard.set(newValue, forKey: "autoCleanupInactiveDays") }
    }
    
    var showBuildTimeInBadges: Bool {
        get { UserDefaults.standard.object(forKey: "showBuildTimeInBadges") as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: "showBuildTimeInBadges") }
    }

    private init() {}

    func reset() {
        showNotifications = true
        notifyOnlyOnFailure = false
        launchAtLogin = false
        statusCheckInterval = 5.0
        soundEnabled = true
        autoCleanupInactiveDays = 7
        showBuildTimeInBadges = true
    }
}
