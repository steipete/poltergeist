//
//  StatusBarMenuView.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import SwiftUI

/// Modern status bar menu view using environment injection and @Observable patterns
struct StatusBarMenuView: View {
    // Modern dependency injection using environment
    @Environment(ProjectMonitor.self) private var projectMonitor
    @Environment(Preferences.self) private var preferences

    let onDismiss: () -> Void

    @State private var expandedProjectIds: Set<String> = []
    @State private var hoveredProjectId: String?

    // Formatter for build durations
    static let buildDurationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.maximumUnitCount = 2
        return formatter
    }()

    var body: some View {
        let currentProjectIds = Set(projectMonitor.projects.map { $0.id })
        VStack(spacing: 0) {
            // Modern header with material background
            HStack(spacing: 12) {
                Image("StatusBarIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 18, height: 18)
                    .foregroundStyle(.primary)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Poltergeist Monitor")
                        .font(.system(size: 15, weight: .semibold))

                    // Build queue status
                    if projectMonitor.buildQueue.hasActivity {
                        HStack(spacing: 4) {
                            if !projectMonitor.buildQueue.activeBuilds.isEmpty {
                                Image(systemName: "arrow.triangle.2.circlepath")
                                    .font(.system(size: 10))
                                    .foregroundColor(.blue)
                                    .symbolEffect(.rotate, isActive: true)
                                Text("\(projectMonitor.buildQueue.activeBuilds.count) building")
                                    .font(.system(size: 11))
                                    .foregroundColor(.blue)
                            }

                            if !projectMonitor.buildQueue.queuedBuilds.isEmpty {
                                if !projectMonitor.buildQueue.activeBuilds.isEmpty {
                                    Text("•")
                                        .font(.system(size: 8))
                                        .foregroundColor(.secondary)
                                }
                                Text("\(projectMonitor.buildQueue.queuedBuilds.count) queued")
                                    .font(.system(size: 11))
                                    .foregroundColor(.orange)
                            }
                        }
                    }
                }

                Spacer()

                Button(action: {
                    projectMonitor.refreshProjects()
                }) {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Refresh")

                Menu {
                    Button(action: { projectMonitor.cleanupInactiveProjects() }) {
                        Label("Clean Up Inactive", systemImage: "trash")
                    }

                    Divider()

                    if #available(macOS 14.0, *) {
                        SettingsLink {
                            Label("Settings...", systemImage: "gear")
                        }
                        .keyboardShortcut(",", modifiers: .command)
                    } else {
                        Button(action: {
                            // Fallback for macOS < 14.0 (though we require 14.0+)
                        }) {
                            Label("Settings... (requires macOS 14.0+)", systemImage: "gear")
                        }
                        .disabled(true)
                    }

                    Divider()

                    Button(action: { NSApp.terminate(nil) }) {
                        Label("Quit", systemImage: "power")
                    }
                    .keyboardShortcut("q", modifiers: .command)
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.secondary)
                }
                .menuStyle(.borderlessButton)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(
                ZStack {
                    Color.clear.background(.ultraThinMaterial)
                    Color.primary.opacity(0.02)
                }
            )

            // Content area
            if projectMonitor.projects.isEmpty {
                EmptyStateView()
            } else {
                ScrollView {
                    LazyVStack(spacing: 8) {
                        // Active builds section (when present)
                        if !projectMonitor.buildQueue.activeBuilds.isEmpty {
                            BuildQueueSectionView(
                                title: "Active Builds",
                                icon: "arrow.triangle.2.circlepath",
                                color: .blue,
                                builds: projectMonitor.buildQueue.activeBuilds.map { .active($0) }
                            )
                        }

                        // Queued builds section (when present)
                        if !projectMonitor.buildQueue.queuedBuilds.isEmpty {
                            BuildQueueSectionView(
                                title: "Build Queue",
                                icon: "clock",
                                color: .orange,
                                builds: projectMonitor.buildQueue.queuedBuilds.map { .queued($0) }
                            )
                        }

                        // Recent builds section (when present and no active builds)
                        if projectMonitor.buildQueue.activeBuilds.isEmpty
                            && !projectMonitor.buildQueue.recentBuilds.isEmpty
                        {
                            BuildQueueSectionView(
                                title: "Recent Builds",
                                icon: "clock.arrow.circlepath",
                                color: .secondary,
                                builds: Array(projectMonitor.buildQueue.recentBuilds.prefix(3)).map
                                { .completed($0) }
                            )
                        }

                        // Project list
                        ForEach(projectMonitor.projects) { project in
                            VStack(spacing: 0) {
                                ModernProjectRow(
                                    project: project,
                                    buildQueue: projectMonitor.buildQueue,
                                    isHovered: hoveredProjectId == project.id,
                                    isExpanded: expandedProjectIds.contains(project.id)
                                )
                                .onTapGesture {
                                    withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
                                        if expandedProjectIds.contains(project.id) {
                                            expandedProjectIds.remove(project.id)
                                        } else {
                                            expandedProjectIds.insert(project.id)
                                        }
                                    }
                                }
                                .onHover { isHovered in
                                    withAnimation(.easeInOut(duration: 0.15)) {
                                        hoveredProjectId = isHovered ? project.id : nil
                                    }
                                }
                                .contextMenu {
                                    ProjectContextMenu(
                                        project: project,
                                        projectMonitor: projectMonitor
                                    )
                                }

                                // Inline expanded detail view
                                if expandedProjectIds.contains(project.id) {
                                    InlineProjectDetailView(
                                        project: project,
                                        buildQueue: projectMonitor.buildQueue,
                                        buildStatistics: projectMonitor.getBuildStatistics()
                                    )
                                    .transition(
                                        .asymmetric(
                                            insertion: .opacity.combined(with: .move(edge: .top)),
                                            removal: .opacity.combined(with: .scale)
                                        ))
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                }
                .background(.ultraThinMaterial)
            }
        }
        .frame(
            minWidth: 420, idealWidth: 480, maxWidth: 540, minHeight: 180, idealHeight: 400,
            maxHeight: 700
        )
        .background(
            VisualEffectView()
        )
        .edgesIgnoringSafeArea(.all)
        .onChange(of: currentProjectIds) { _, newValue in
            // Remove expanded state for projects that no longer exist
            expandedProjectIds = expandedProjectIds.intersection(newValue)
        }
    }
}

struct EmptyStateView: View {
    var body: some View {
        VStack(spacing: 20) {
            ZStack {
                Circle()
                    .fill(.ultraThinMaterial)
                    .frame(width: 80, height: 80)

                Image("StatusBarIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 42, height: 42)
                    .foregroundStyle(.tertiary)
            }

            VStack(spacing: 8) {
                Text("No Poltergeist instances found")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(.primary)

                Text("Start monitoring a project:")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)

                HStack {
                    Image(systemName: "terminal.fill")
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)

                    Text("poltergeist haunt")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.primary)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(.regularMaterial)
                .cornerRadius(8)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }
}

// New build queue section view
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

            // Build items
            ForEach(builds.indices, id: \.self) { index in
                let build = builds[index]
                BuildQueueItemView(build: build)
            }
        }
        .padding(10)
        .background(.regularMaterial)
        .cornerRadius(8)
    }
}

// Build queue item view
struct BuildQueueItemView: View {
    let build: BuildQueueSectionView.BuildDisplayItem

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
        .padding(.vertical, 4)
        .padding(.horizontal, 6)
        .background(buildBackgroundColor)
        .cornerRadius(4)
    }

    @ViewBuilder
    private var buildStatusIndicator: some View {
        switch build {
        case .active:
            ZStack {
                Circle()
                    .fill(Color.blue.opacity(0.2))
                    .frame(width: 24, height: 24)

                Image(systemName: "arrow.triangle.2.circlepath")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.blue)
                    .symbolEffect(.rotate, isActive: true)
            }

        case .queued:
            ZStack {
                Circle()
                    .fill(Color.orange.opacity(0.2))
                    .frame(width: 24, height: 24)

                Image(systemName: "clock")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.orange)
            }

        case .completed(let completedBuild):
            ZStack {
                Circle()
                    .fill((completedBuild.wasSuccessful ? Color.green : Color.red).opacity(0.2))
                    .frame(width: 24, height: 24)

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
                    StatusBarMenuView.buildDurationFormatter.string(from: completedBuild.duration)
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

struct ModernProjectRow: View {
    let project: Project
    let buildQueue: BuildQueueInfo
    let isHovered: Bool
    let isExpanded: Bool

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
                    StatusBarMenuView.buildDurationFormatter.string(from: buildTime)
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

struct InlineProjectDetailView: View {
    let project: Project
    let buildQueue: BuildQueueInfo
    let buildStatistics: BuildStatistics

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
                                    StatusBarMenuView.buildDurationFormatter.string(from: buildTime)
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
                                StatusBarMenuView.buildDurationFormatter.string(
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

struct ProjectContextMenu: View {
    let project: Project
    let projectMonitor: ProjectMonitor

    var body: some View {
        Button(action: {
            NSWorkspace.shared.open(URL(fileURLWithPath: project.path))
        }) {
            Label("Open in Finder", systemImage: "folder")
        }

        Button(action: {
            NSWorkspace.shared.open(URL(fileURLWithPath: project.path))
        }) {
            Label("Open in Terminal", systemImage: "terminal")
        }

        if project.overallStatus == .failed {
            Divider()

            Button(action: {
                // Copy error to clipboard
                if let error = project.targets.values.compactMap({ $0.lastBuild?.errorSummary })
                    .first
                {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(error, forType: .string)
                }
            }) {
                Label("Copy Error", systemImage: "doc.on.clipboard")
            }
        }

        Divider()

        Button(action: {
            print("🔴 [ProjectContextMenu] Remove from Monitor clicked for project: \(project.name)")
            print("🔴 [ProjectContextMenu] Project path: \(project.path)")
            print("🔴 [ProjectContextMenu] Project hash: \(project.hash)")
            print(
                "🔴 [ProjectContextMenu] Project targets: \(project.targets.keys.joined(separator: ", "))"
            )

            Task { @MainActor in
                print("🔴 [ProjectContextMenu] Calling projectMonitor.removeProject...")
                projectMonitor.removeProject(project)
                print("🔴 [ProjectContextMenu] removeProject call completed")
            }
        }) {
            Label("Remove from Monitor", systemImage: "trash")
        }
        .foregroundColor(.red)
    }
}

// Build statistics dashboard
struct BuildStatisticsDashboard: View {
    let statistics: BuildStatistics

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Build Statistics (24h)")
                .font(.system(size: 13, weight: .semibold))
                .foregroundColor(.primary)

            // Statistics grid
            LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 2), spacing: 12) {
                StatCard(
                    title: "Total Builds",
                    value: "\(statistics.totalBuilds24h)",
                    icon: "hammer.fill",
                    color: .blue
                )

                StatCard(
                    title: "Success Rate",
                    value: String(format: "%.0f%%", statistics.successRate * 100),
                    icon: "checkmark.shield.fill",
                    color: statistics.successRate >= 0.8
                        ? .green : (statistics.successRate >= 0.5 ? .orange : .red)
                )

                StatCard(
                    title: "Avg Build Time",
                    value: StatusBarMenuView.buildDurationFormatter.string(
                        from: statistics.averageBuildTime)
                        ?? String(format: "%.1fs", statistics.averageBuildTime),
                    icon: "clock.fill",
                    color: .purple
                )

                StatCard(
                    title: "Active Now",
                    value: "\(statistics.currentActiveBuilds)",
                    icon: "arrow.triangle.2.circlepath",
                    color: statistics.currentActiveBuilds > 0 ? .blue : .gray
                )
            }
        }
        .padding(12)
        .background(.regularMaterial)
        .cornerRadius(8)
    }
}

// Individual stat card
struct StatCard: View {
    let title: String
    let value: String
    let icon: String
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(color)

                Text(title)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Text(value)
                .font(.system(size: 16, weight: .bold))
                .foregroundColor(.primary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(8)
        .background(color.opacity(0.1))
        .cornerRadius(6)
    }
}
