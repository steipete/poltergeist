import Foundation
import UserNotifications
import AppKit
import os.log

@MainActor
class NotificationManager {
    static let shared = NotificationManager()
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "Notifications")
    private var lastNotifiedStates: [String: String] = [:]
    
    private init() {
        requestAuthorization()
    }
    
    private func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if granted {
                self.logger.info("Notification authorization granted")
            } else if let error = error {
                self.logger.error("Failed to request notification authorization: \(error.localizedDescription)")
            }
        }
    }
    
    func notifyBuildStatusChange(project: Project, target: String, newStatus: String, errorSummary: String? = nil) {
        guard Preferences.shared.showNotifications else { return }
        
        // Skip if only notifying on failures and this isn't a failure
        if Preferences.shared.notifyOnlyOnFailure && newStatus != "failed" {
            return
        }
        
        // Create unique key for this project/target combination
        let key = "\(project.path)-\(target)"
        
        // Check if we've already notified about this state
        let notificationKey = "\(key)-\(newStatus)"
        if lastNotifiedStates[key] == notificationKey {
            return
        }
        lastNotifiedStates[key] = notificationKey
        
        let content = UNMutableNotificationContent()
        content.title = "Poltergeist: \(project.name)"
        
        switch newStatus {
        case "success":
            content.subtitle = "\(target) build succeeded"
            content.body = "Build completed successfully"
            if Preferences.shared.soundEnabled {
                content.sound = .default
            }
            
        case "failed":
            content.subtitle = "\(target) build failed"
            content.body = errorSummary ?? "Build failed with errors"
            if Preferences.shared.soundEnabled {
                content.sound = UNNotificationSound(named: UNNotificationSoundName("Basso"))
            }
            
        case "building":
            // Don't notify for building status
            return
            
        default:
            return
        }
        
        // Add project path as user info for potential actions
        content.userInfo = ["projectPath": project.path, "target": target]
        
        // Create and deliver the notification
        let request = UNNotificationRequest(
            identifier: key,
            content: content,
            trigger: nil
        )
        
        UNUserNotificationCenter.current().add(request) { error in
            if let error = error {
                self.logger.error("Failed to deliver notification: \(error.localizedDescription)")
            }
        }
    }
    
    func clearNotifications(for project: Project) {
        let identifiers = project.targets.keys.map { "\(project.path)-\($0)" }
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: identifiers)
        
        // Clear last notified states
        for identifier in identifiers {
            lastNotifiedStates.removeValue(forKey: identifier)
        }
    }
}