import Foundation
import ServiceManagement
import os.log

//
//  LaunchAtLogin.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

@MainActor
final class LaunchAtLogin: @unchecked Sendable {
    static let shared = LaunchAtLogin()
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "LaunchAtLogin")

    private init() {}

    var isEnabled: Bool {
        get {
            if #available(macOS 13.0, *) {
                return SMAppService.mainApp.status == .enabled
            } else {
                // Fallback for older versions
                return false
            }
        }
        set {
            if #available(macOS 13.0, *) {
                do {
                    if newValue {
                        if SMAppService.mainApp.status == .enabled {
                            logger.debug("Launch at login already enabled")
                            return
                        }
                        try SMAppService.mainApp.register()
                        logger.info("Launch at login enabled")
                    } else {
                        if SMAppService.mainApp.status == .notRegistered {
                            logger.debug("Launch at login already disabled")
                            return
                        }
                        try SMAppService.mainApp.unregister()
                        logger.info("Launch at login disabled")
                    }
                } catch {
                    logger.error(
                        "Failed to \(newValue ? "enable" : "disable") launch at login: \(error.localizedDescription)"
                    )
                }
            }
        }
    }
}
