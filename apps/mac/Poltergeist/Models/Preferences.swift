import Combine
import Foundation
import SwiftUI

//
//  Preferences.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

@MainActor
class Preferences: ObservableObject {
    static let shared = Preferences()

    @AppStorage("showNotifications") var showNotifications: Bool = true {
        didSet { objectWillChange.send() }
    }
    @AppStorage("notifyOnlyOnFailure") var notifyOnlyOnFailure: Bool = false {
        didSet { objectWillChange.send() }
    }
    @AppStorage("launchAtLogin") var launchAtLogin: Bool = false {
        didSet { objectWillChange.send() }
    }
    @AppStorage("statusCheckInterval") var statusCheckInterval: TimeInterval = 5.0 {
        didSet { objectWillChange.send() }
    }
    @AppStorage("soundEnabled") var soundEnabled: Bool = true {
        didSet { objectWillChange.send() }
    }
    @AppStorage("autoCleanupInactiveDays") var autoCleanupInactiveDays: Int = 7 {
        didSet { objectWillChange.send() }
    }
    @AppStorage("showBuildTimeInBadges") var showBuildTimeInBadges: Bool = true {
        didSet { objectWillChange.send() }
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
