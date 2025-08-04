import AppKit
import Foundation
import UserNotifications
import os.log

//
//  NotificationManager.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

/// Modern notification manager with Swift 6 concurrency support and Sendable compliance
@MainActor
final class NotificationManager: @unchecked Sendable {
    static let shared = NotificationManager()
    
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "Notifications")
    private var lastNotifiedStates: [String: String] = [:]
    private let notificationCenter = UNUserNotificationCenter.current()

    private init() {
        Task {
            await requestAuthorization()
        }
    }

    nonisolated private func requestAuthorization() async {
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            await MainActor.run {
                if granted {
                    logger.info("✅ Notification authorization granted")
                } else {
                    logger.warning("⚠️ Notification authorization denied")
                }
            }
        } catch {
            await MainActor.run {
                logger.error("❌ Failed to request notification authorization: \(error.localizedDescription)")
            }
        }
    }

    func notifyBuildStatusChange(
        project: Project, target: String, newStatus: String, errorSummary: String? = nil
    ) {
        let preferences = Preferences.shared
        guard preferences.showNotifications else { return }

        // Skip if only notifying on failures and this isn't a failure
        if preferences.notifyOnlyOnFailure && newStatus != "failed" {
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

        Task {
            await deliverNotification(
                key: key,
                project: project,
                target: target,
                status: newStatus,
                errorSummary: errorSummary,
                soundEnabled: preferences.soundEnabled
            )
        }
    }
    
    nonisolated private func deliverNotification(
        key: String,
        project: Project,
        target: String,
        status: String,
        errorSummary: String?,
        soundEnabled: Bool
    ) async {
        let content = createNotificationContent(
            project: project,
            target: target,
            status: status,
            errorSummary: errorSummary,
            soundEnabled: soundEnabled
        )
        
        guard let content = content else { return }

        let request = UNNotificationRequest(
            identifier: key,
            content: content,
            trigger: nil
        )

        do {
            try await UNUserNotificationCenter.current().add(request)
            await MainActor.run {
                logger.debug("✅ Notification delivered for \(project.name):\(target)")
            }
        } catch {
            await MainActor.run {
                logger.error("❌ Failed to deliver notification: \(error.localizedDescription)")
            }
        }
    }
    
    nonisolated private func createNotificationContent(
        project: Project,
        target: String,
        status: String,
        errorSummary: String?,
        soundEnabled: Bool
    ) -> UNMutableNotificationContent? {
        let content = UNMutableNotificationContent()
        content.title = "Poltergeist: \(project.name)"
        content.userInfo = ["projectPath": project.path, "target": target]

        switch status {
        case "success":
            content.subtitle = "\(target) build succeeded"
            content.body = "Build completed successfully"
            if soundEnabled {
                content.sound = .default
            }

        case "failed":
            content.subtitle = "\(target) build failed"
            content.body = errorSummary ?? "Build failed with errors"
            if soundEnabled {
                content.sound = UNNotificationSound(named: UNNotificationSoundName("Basso"))
            }

        case "building":
            // Don't notify for building status
            return nil

        default:
            return nil
        }
        
        return content
    }

    func clearNotifications(for project: Project) {
        let identifiers = project.targets.keys.map { "\(project.path)-\($0)" }
        
        Task {
            await clearDeliveredNotifications(identifiers: identifiers)
        }
        
        // Clear last notified states synchronously
        for identifier in identifiers {
            lastNotifiedStates.removeValue(forKey: identifier)
        }
    }
    
    private func clearDeliveredNotifications(identifiers: [String]) async {
        notificationCenter.removeDeliveredNotifications(withIdentifiers: identifiers)
        logger.debug("🗑️ Cleared \(identifiers.count) notifications")
    }
}
