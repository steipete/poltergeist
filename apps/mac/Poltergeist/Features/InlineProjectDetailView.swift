//
//  InlineProjectDetailView.swift
//  Poltergeist
//

import SwiftUI

struct InlineProjectDetailView: View {
    let project: Project
    let buildQueue: BuildQueueInfo
    let buildStatistics: BuildStatistics

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Build statistics dashboard
            if buildStatistics.totalBuilds24h > 0 {
                BuildStatisticsDashboard(statistics: buildStatistics)
            }

            ForEach(project.sortedTargets, id: \.key) { target, state in
                VStack(alignment: .leading, spacing: 8) {
                    // Target header with build progress
                    HStack {
                        Label(target, systemImage: "target")
                            .font(.system(size: 14, weight: .semibold))

                        // Show active build progress if available
                        if let activeBuild = buildQueue.activeBuilds.first(where: {
                            $0.target == target && $0.project == project.name
                        }) {
                            if let progress = activeBuild.progress {
                                ProgressView(value: progress, total: 1.0)
                                    .progressViewStyle(LinearProgressViewStyle())
                                    .frame(width: 80)
                                    .scaleEffect(0.8)
                            }
                        }

                        Spacer()

                        if state.isActive {
                            Label("Active", systemImage: "circle.fill")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.green)
                        } else {
                            Label("Inactive", systemImage: "moon.zzz")
                                .font(.system(size: 11, weight: .medium))
                                .foregroundColor(.gray)
                        }
                    }

                    // Build info
                    if let build = state.lastBuild {
                        HStack(spacing: 12) {
                            // Status
                            Label(
                                build.status.capitalized,
                                systemImage: build.status == "success"
                                    ? "checkmark.circle.fill" : "xmark.circle.fill"
                            )
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(build.status == "success" ? .green : .red)

                            // Build time
                            if let buildTime = build.buildTime {
                                let formattedTime =
                                    InlineProjectDetailView.buildDurationFormatter.string(
                                        from: buildTime)
                                    ?? String(format: "%.2fs", buildTime)
                                Text(formattedTime)
                                    .font(.system(size: 12))
                                    .foregroundColor(.secondary)
                            }

                            // Git hash
                            if let gitHash = build.gitHash {
                                HStack(spacing: 2) {
                                    Image(systemName: "number")
                                        .font(.system(size: 10))
                                    Text(String(gitHash.prefix(7)))
                                        .font(.system(size: 11, design: .monospaced))
                                }
                                .foregroundColor(.secondary)
                            }

                            Spacer()
                        }

                        // Error display
                        if let error = build.errorSummary, !error.isEmpty {
                            Text(error)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundColor(.primary)
                                .padding(10)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .background(Color.red.opacity(0.1))
                                .cornerRadius(6)
                                .textSelection(.enabled)
                        }
                    } else {
                        Text("No build information available")
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                            .italic()
                    }
                }
                .padding(12)
                .background(.regularMaterial)
                .cornerRadius(8)
            }

            // Recent builds for this project
            let projectBuilds = buildQueue.recentBuilds.filter { $0.project == project.name }
            if !projectBuilds.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Recent Builds")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.primary)

                    ForEach(Array(projectBuilds.prefix(5)), id: \.id) { build in
                        HStack(spacing: 8) {
                            // Status indicator
                            Image(
                                systemName: build.wasSuccessful
                                    ? "checkmark.circle.fill" : "xmark.circle.fill"
                            )
                            .font(.system(size: 12))
                            .foregroundColor(build.wasSuccessful ? .green : .red)

                            Text(build.target)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(.primary)

                            Text(
                                InlineProjectDetailView.buildDurationFormatter.string(
                                    from: build.duration) ?? String(format: "%.1fs", build.duration)
                            )
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)

                            Spacer()

                            Text(timeAgoString(from: build.completedAt))
                                .font(.system(size: 11))
                                .foregroundColor(.secondary)
                        }
                    }
                }
                .padding(12)
                .background(.regularMaterial)
                .cornerRadius(8)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.primary.opacity(0.02))
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
