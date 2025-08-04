//
//  ProjectRowViews.swift
//  Poltergeist
//

import SwiftUI

struct ModernProjectRow: View {
    let project: Project
    let buildQueue: BuildQueueInfo
    let isHovered: Bool
    let isExpanded: Bool

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    private var timeSinceLastBuild: String {
        guard
            let mostRecentBuild = project.targets.values
                .compactMap({ $0.lastBuild })
                .max(by: { $0.timestamp < $1.timestamp })
        else {
            return "No builds yet"
        }

        let now = Date()
        let timeDifference = now.timeIntervalSince(mostRecentBuild.timestamp)

        // If timestamp is in the future (clock skew), show "just now"
        if timeDifference < 0 {
            return "just now"
        }

        // Use a custom formatter to ensure we always show past tense
        if timeDifference < 60 {
            return "just now"
        } else if timeDifference < 3600 {
            let minutes = Int(timeDifference / 60)
            return "\(minutes)m ago"
        } else if timeDifference < 86400 {
            let hours = Int(timeDifference / 3600)
            return "\(hours)h ago"
        } else {
            let days = Int(timeDifference / 86400)
            return "\(days)d ago"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Main content
            HStack(alignment: .top, spacing: 12) {
                // Status icon
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color(project.overallStatus.color).opacity(0.15))
                        .frame(width: 40, height: 40)

                    Image(systemName: project.overallStatus.icon)
                        .font(.system(size: 18, weight: .medium))
                        .foregroundColor(Color(project.overallStatus.color))
                        .symbolEffect(.pulse, isActive: project.overallStatus == .building)
                }

                VStack(alignment: .leading, spacing: 6) {
                    // Project name and path
                    VStack(alignment: .leading, spacing: 2) {
                        Text(project.name)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.primary)

                        HStack(spacing: 4) {
                            Image(systemName: "folder")
                                .font(.system(size: 10))
                                .foregroundColor(.secondary)

                            Text(project.path)
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    // Targets with build info
                    HStack(spacing: 8) {
                        ForEach(project.sortedTargets, id: \.key) { target, state in
                            ModernTargetBadge(name: target, state: state)
                        }

                        Spacer()

                        // Last build time
                        HStack(spacing: 4) {
                            Image(systemName: "clock")
                                .font(.system(size: 10))
                            Text(timeSinceLastBuild)
                                .font(.system(size: 11))
                        }
                        .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Chevron
                Image(systemName: isExpanded ? "chevron.down" : "chevron.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.secondary.opacity(0.5))
                    .opacity(isHovered || isExpanded ? 1 : 0.5)
                    .animation(.easeInOut(duration: 0.2), value: isExpanded)
            }
            .padding(12)
        }
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.primary.opacity(isHovered ? 0.05 : 0))
                .animation(.easeInOut(duration: 0.15), value: isHovered)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.primary.opacity(isHovered ? 0.1 : 0), lineWidth: 1)
                .animation(.easeInOut(duration: 0.15), value: isHovered)
        )
    }
}

struct ModernTargetBadge: View {
    let name: String
    let state: TargetState

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    private var config: (icon: String, color: Color, isAnimating: Bool) {
        if !state.isActive {
            return ("moon.zzz", .gray, false)
        }

        switch state.lastBuild?.status {
        case "failed": return ("xmark.circle.fill", .red, false)
        case "success": return ("checkmark.circle.fill", .green, false)
        case "building": return ("arrow.triangle.2.circlepath", .blue, true)
        default: return ("minus.circle", .secondary, false)
        }
    }

    var body: some View {
        HStack(spacing: 4) {
            // Show custom icon if available, otherwise show status icon
            if let customIcon = state.icon {
                Image(nsImage: customIcon)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 12, height: 12)
            } else {
                Image(systemName: config.icon)
                    .font(.system(size: 11, weight: .medium))
                    .symbolEffect(.rotate, isActive: config.isAnimating)
            }

            Text(name)
                .font(.system(size: 12, weight: .medium))

            if let buildTime = state.lastBuild?.buildTime {
                let formattedTime =
                    ModernTargetBadge.buildDurationFormatter.string(from: buildTime)
                    ?? String(format: "%.1fs", buildTime)
                Text("(\(formattedTime))")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }
        }
        .foregroundColor(config.color)
        .padding(.horizontal, 10)
        .padding(.vertical, 4)
        .background(
            Capsule()
                .fill(config.color.opacity(0.15))
        )
    }
}
