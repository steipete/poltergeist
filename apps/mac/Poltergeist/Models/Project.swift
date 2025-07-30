import Foundation
import AppKit

struct Project: Identifiable, Equatable {
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
    
    enum BuildStatus {
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

struct TargetState: Equatable {
    let target: String
    let isActive: Bool
    let lastHeartbeat: Date?
    let lastBuild: BuildInfo?
    var icon: NSImage?
    
    var isStale: Bool {
        guard let heartbeat = lastHeartbeat else { return true }
        return Date().timeIntervalSince(heartbeat) > 30
    }
}

struct BuildInfo: Equatable {
    let status: String
    let timestamp: Date
    let errorSummary: String?
    let buildTime: Double?
    let gitHash: String?
}

// State file models matching Poltergeist's output
struct PoltergeistState: Codable {
    let version: String
    let projectPath: String
    let projectName: String
    let target: String
    let configPath: String
    let process: ProcessInfo
    let lastBuild: BuildStatus?
    let appInfo: AppInfo
    
    struct ProcessInfo: Codable {
        let pid: Int
        let isActive: Bool
        let startTime: String
        let lastHeartbeat: String
    }
    
    struct BuildStatus: Codable {
        let status: String
        let timestamp: String
        let gitHash: String?
        let errorSummary: String?
        let buildTime: Double?
        let fullError: String?
    }
    
    struct AppInfo: Codable {
        let bundleId: String?
        let outputPath: String?
        let iconPath: String?
    }
}