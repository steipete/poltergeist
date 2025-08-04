//
//  BuildQueueViews.swift
//  Poltergeist
//

import SwiftUI

// Build queue section view
struct BuildQueueSectionView: View {
    let title: String
    let icon: String
    let color: Color
    let builds: [BuildDisplayItem]

    enum BuildDisplayItem {
        case active(ActiveBuild)
        case queued(QueuedBuild)
        case completed(CompletedBuild)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            // Section header
            HStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(color)
                    .symbolEffect(.rotate, isActive: icon.contains("circlepath"))

                Text(title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.primary)

                Spacer()

                Text("\(builds.count)")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 2)
                    .background(color.opacity(0.2))
                    .cornerRadius(8)
            }

            // Build items in a clear vertical list with better spacing
            VStack(spacing: 6) {
                ForEach(builds.indices, id: \.self) { index in
                    let build = builds[index]
                    BuildQueueItemView(build: build)
                }
            }
        }
        .padding(14)
        .background(.regularMaterial)
        .cornerRadius(10)
    }
}

// Build queue item view
struct BuildQueueItemView: View {
    let build: BuildQueueSectionView.BuildDisplayItem

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    var body: some View {
        HStack(spacing: 12) {
            // Status indicator
            buildStatusIndicator

            VStack(alignment: .leading, spacing: 2) {
                // Project and target
                HStack(spacing: 4) {
                    Text(buildProjectName)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.primary)

                    Text(":")
                        .font(.system(size: 13))
                        .foregroundColor(.secondary)

                    Text(buildTargetName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(.secondary)
                }

                // Additional info
                buildAdditionalInfo
            }

            Spacer()

            // Progress or duration
            buildRightInfo
        }
        .padding(.vertical, 8)
        .padding(.horizontal, 12)
        .background(buildBackgroundColor)
        .cornerRadius(8)
    }

    @ViewBuilder
    private var buildStatusIndicator: some View {
        switch build {
        case .active:
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 28, height: 28)

                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.blue)
                    .symbolEffect(.rotate, isActive: true)
            }

        case .queued:
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.2))
                    .frame(width: 28, height: 28)

                Image(systemName: "clock")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.orange)
            }

        case .completed(let completedBuild):
            ZStack {
                Circle()
                    .fill((completedBuild.wasSuccessful ? Color.green : Color.red).opacity(0.2))
                    .frame(width: 28, height: 28)

                Image(
                    systemName: completedBuild.wasSuccessful
                        ? "checkmark.circle.fill" : "xmark.circle.fill"
                )
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(completedBuild.wasSuccessful ? .green : .red)
            }
        }
    }

    private var buildProjectName: String {
        switch build {
        case .active(let activeBuild): return activeBuild.project
        case .queued(let queuedBuild): return queuedBuild.project
        case .completed(let completedBuild): return completedBuild.project
        }
    }

    private var buildTargetName: String {
        switch build {
        case .active(let activeBuild): return activeBuild.target
        case .queued(let queuedBuild): return queuedBuild.target
        case .completed(let completedBuild): return completedBuild.target
        }
    }

    @ViewBuilder
    private var buildAdditionalInfo: some View {
        switch build {
        case .active(let activeBuild):
            if let phase = activeBuild.currentPhase {
                Text(phase.capitalized)
                    .font(.system(size: 11))
                    .foregroundColor(.blue)
            }

        case .queued(let queuedBuild):
            Text(queuedBuild.reason.replacingOccurrences(of: "-", with: " ").capitalized)
                .font(.system(size: 11))
                .foregroundColor(.orange)

        case .completed(let completedBuild):
            HStack(spacing: 4) {
                Text(timeAgoString(from: completedBuild.completedAt))
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)

                if let gitHash = completedBuild.gitHash {
                    Text("•")
                        .font(.system(size: 8))
                        .foregroundColor(.secondary)

                    Text(String(gitHash.prefix(7)))
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.secondary)
                }
            }
        }
    }

    @ViewBuilder
    private var buildRightInfo: some View {
        switch build {
        case .active(let activeBuild):
            VStack(alignment: .trailing, spacing: 2) {
                if let progress = activeBuild.progress {
                    // Progress bar
                    ProgressView(value: progress, total: 1.0)
                        .progressViewStyle(LinearProgressViewStyle())
                        .frame(width: 60)
                        .scaleEffect(0.8)

                    Text("\(Int(progress * 100))%")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.blue)
                } else {
                    // Elapsed time
                    Text(elapsedTimeString(from: activeBuild.startedAt))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundColor(.blue)
                }
            }

        case .queued(let queuedBuild):
            VStack(alignment: .trailing, spacing: 2) {
                Text("Priority \(queuedBuild.priority)")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)

                Text(timeAgoString(from: queuedBuild.queuedAt))
                    .font(.system(size: 11))
                    .foregroundColor(.orange)
            }

        case .completed(let completedBuild):
            VStack(alignment: .trailing, spacing: 2) {
                Text(
                    BuildQueueItemView.buildDurationFormatter.string(from: completedBuild.duration)
                        ?? String(format: "%.1fs", completedBuild.duration)
                )
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)

                Text(completedBuild.status.capitalized)
                    .font(.system(size: 10))
                    .foregroundColor(completedBuild.wasSuccessful ? .green : .red)
            }
        }
    }

    private var buildBackgroundColor: Color {
        switch build {
        case .active: return Color.blue.opacity(0.05)
        case .queued: return Color.orange.opacity(0.05)
        case .completed(let completedBuild):
            return (completedBuild.wasSuccessful ? Color.green : Color.red).opacity(0.05)
        }
    }

    private func elapsedTimeString(from startTime: Date) -> String {
        let elapsed = Date().timeIntervalSince(startTime)
        if elapsed < 60 {
            return String(format: "%.0fs", elapsed)
        } else {
            let minutes = Int(elapsed / 60)
            let seconds = Int(elapsed) % 60
            return "\(minutes)m\(seconds)s"
        }
    }

    private func timeAgoString(from date: Date) -> String {
        let elapsed = Date().timeIntervalSince(date)
        if elapsed < 0 {
            return "now"
        } else if elapsed < 60 {
            return "\(Int(elapsed))s ago"
        } else if elapsed < 3600 {
            return "\(Int(elapsed / 60))m ago"
        } else if elapsed < 86400 {
            return "\(Int(elapsed / 3600))h ago"
        } else {
            return "\(Int(elapsed / 86400))d ago"
        }
    }
}
