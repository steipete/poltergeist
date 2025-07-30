import SwiftUI

struct StatusBarMenuView: View {
    @ObservedObject var projectMonitor: ProjectMonitor
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
                Image(systemName: "ghost.fill")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.primary)
                    .symbolEffect(.pulse, isActive: true)
                
                Text("Poltergeist Monitor")
                    .font(.system(size: 15, weight: .semibold))
                
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
                    
                    Button(action: { 
                        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                    }) {
                        Label("Settings...", systemImage: "gear")
                    }
                    .keyboardShortcut(",", modifiers: .command)
                    .disabled(true) // Temporarily disabled
                    
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
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(.ultraThinMaterial)
            
            // Content area
            if projectMonitor.projects.isEmpty {
                EmptyStateView()
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(projectMonitor.projects) { project in
                            VStack(spacing: 0) {
                                ModernProjectRow(
                                    project: project,
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
                                    InlineProjectDetailView(project: project)
                                        .transition(.asymmetric(
                                            insertion: .opacity.combined(with: .move(edge: .top)),
                                            removal: .opacity.combined(with: .scale)
                                        ))
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                }
                .background(.thinMaterial)
            }
        }
        .frame(minWidth: 480, minHeight: 200, maxHeight: 600)
        .background(.thinMaterial)
        .onChange(of: currentProjectIds) { oldValue, newValue in
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
                
                Image(systemName: "ghost.fill")
                    .font(.system(size: 42))
                    .foregroundStyle(.tertiary)
                    .symbolEffect(.pulse.byLayer, isActive: true)
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
        .padding(40)
    }
}

struct ModernProjectRow: View {
    let project: Project
    let isHovered: Bool
    let isExpanded: Bool
    
    private var timeSinceLastBuild: String {
        guard let mostRecentBuild = project.targets.values
            .compactMap({ $0.lastBuild })
            .max(by: { $0.timestamp < $1.timestamp }) else {
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
            .padding(14)
        }
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(isHovered ? .regularMaterial : .ultraThinMaterial)
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
        default: return ("circle.dotted", .gray, false)
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
                let formattedTime = StatusBarMenuView.buildDurationFormatter.string(from: buildTime) ?? String(format: "%.1fs", buildTime)
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
    
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(project.sortedTargets, id: \.key) { target, state in
                VStack(alignment: .leading, spacing: 8) {
                    // Target header
                    HStack {
                        Label(target, systemImage: "target")
                            .font(.system(size: 14, weight: .semibold))
                        
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
                                systemImage: build.status == "success" ? "checkmark.circle.fill" : "xmark.circle.fill"
                            )
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(build.status == "success" ? .green : .red)
                            
                            // Build time
                            if let buildTime = build.buildTime {
                                let formattedTime = StatusBarMenuView.buildDurationFormatter.string(from: buildTime) ?? String(format: "%.2fs", buildTime)
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
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.primary.opacity(0.02))
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
                if let error = project.targets.values.compactMap({ $0.lastBuild?.errorSummary }).first {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(error, forType: .string)
                }
            }) {
                Label("Copy Error", systemImage: "doc.on.clipboard")
            }
        }
        
        Divider()
        
        Button(action: {
            projectMonitor.removeProject(project)
        }) {
            Label("Remove from Monitor", systemImage: "trash")
        }
        .foregroundColor(.red)
    }
}