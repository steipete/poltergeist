//
//  StatusBarMenuView.swift
//  Poltergeist
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
                    LazyVStack(spacing: 12) {
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
