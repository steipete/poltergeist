import AppKit
import Foundation

//
//  Project.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

/// Modern project model with Swift 6 Sendable compliance
struct Project: Identifiable, Equatable, Sendable {
    let path: String
    let name: String
    let hash: String
    var targets: [String: TargetState] = [:]

    // Use path as stable identifier
    var id: String {
        path
    }

    var sortedTargets: [(key: String, value: TargetState)] {
        targets.sorted { $0.key < $1.key }
    }

    var overallStatus: BuildStatus {
        let statuses = targets.values.compactMap { $0.lastBuild?.status }
        if statuses.contains("failed") { return .failed }
        if statuses.contains("building") { return .building }
        if statuses.isEmpty { return .idle }
        return .success
    }

    enum BuildStatus: Sendable {
        case idle, building, success, failed

        var icon: String {
            switch self {
            case .idle: return "circle.dotted"
            case .building: return "arrow.triangle.2.circlepath"
            case .success: return "checkmark.circle.fill"
            case .failed: return "xmark.circle.fill"
            }
        }

        var color: NSColor {
            switch self {
            case .idle: return .systemGray
            case .building: return .systemBlue
            case .success: return .systemGreen
            case .failed: return .systemRed
            }
        }
    }
}

struct TargetState: Equatable, @unchecked Sendable {
    let target: String
    let isActive: Bool
    let lastHeartbeat: Date?
    let lastBuild: BuildInfo?
    var icon: NSImage?  // @unchecked Sendable due to NSImage

    var isStale: Bool {
        guard let heartbeat = lastHeartbeat else { return true }
        // Use same staleness threshold as CLI (5 minutes = 300 seconds)
        return Date().timeIntervalSince(heartbeat) > 300
    }
}

struct BuildInfo: Equatable, Sendable {
    let status: String
    let timestamp: Date
    let errorSummary: String?
    let buildTime: Double?
    let gitHash: String?
    let startTime: Date?

    var isBuilding: Bool {
        status == "building"
    }

    var buildProgress: Double? {
        guard isBuilding, let start = startTime else { return nil }
        let elapsed = Date().timeIntervalSince(start)
        // Rough estimate: most builds complete within 30 seconds
        return min(elapsed / 30.0, 0.95)  // Cap at 95% to show indeterminate state
    }
}

// Enhanced build queue information
struct BuildQueueInfo: Equatable, Sendable {
    let queuedBuilds: [QueuedBuild]
    let activeBuilds: [ActiveBuild]
    let recentBuilds: [CompletedBuild]

    var totalQueueLength: Int {
        queuedBuilds.count + activeBuilds.count
    }

    var hasActivity: Bool {
        !activeBuilds.isEmpty || !queuedBuilds.isEmpty
    }
}

struct QueuedBuild: Equatable, Identifiable, Sendable {
    let id = UUID()
    let target: String
    let project: String
    let queuedAt: Date
    let priority: Int
    let reason: String  // "file-change", "manual", "dependency"
}

struct ActiveBuild: Equatable, Identifiable, Sendable {
    let id = UUID()
    let target: String
    let project: String
    let startedAt: Date
    let estimatedDuration: TimeInterval?
    let progress: Double?  // 0.0 to 1.0, nil for indeterminate
    let currentPhase: String?  // "compiling", "linking", "testing"
}

struct CompletedBuild: Equatable, Identifiable, Sendable {
    let id = UUID()
    let target: String
    let project: String
    let startedAt: Date
    let completedAt: Date
    let status: String
    let duration: TimeInterval
    let errorSummary: String?
    let gitHash: String?

    var wasSuccessful: Bool {
        status == "success"
    }

    var timeSinceCompletion: TimeInterval {
        Date().timeIntervalSince(completedAt)
    }
}

// State file models matching Poltergeist's output
struct PoltergeistState: Codable, Sendable {
    let version: String
    let projectPath: String
    let projectName: String
    let target: String
    let configPath: String
    let process: ProcessInfo
    let lastBuild: BuildStatus?
    let appInfo: AppInfo

    struct ProcessInfo: Codable, Sendable {
        let pid: Int
        let isActive: Bool
        let startTime: String
        let lastHeartbeat: String
    }

    struct BuildStatus: Codable, Sendable {
        let status: String
        let timestamp: String
        let startTime: String?  // When build started (for progress calculation)
        let gitHash: String?
        let errorSummary: String?
        let buildTime: Double?
        let fullError: String?
        let currentPhase: String?  // Current build phase for active builds
        let estimatedDuration: Double?  // Estimated total duration
    }

    struct AppInfo: Codable, Sendable {
        let bundleId: String?
        let outputPath: String?
        let iconPath: String?
    }
}
