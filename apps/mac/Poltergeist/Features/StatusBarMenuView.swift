import SwiftUI

struct StatusBarMenuView: View {
    @ObservedObject var projectMonitor: ProjectMonitor
    let onDismiss: () -> Void
    
    @State private var selectedProject: Project?
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "ghost.fill")
                    .foregroundColor(.primary)
                Text("Poltergeist Monitor")
                    .font(.headline)
                Spacer()
                
                Menu {
                    Button("Clean Up Inactive Projects") {
                        projectMonitor.cleanupInactiveProjects()
                    }
                    
                    Divider()
                    
                    Button("Preferences...") {
                        NSApp.sendAction(Selector(("showSettingsWindow:")), to: nil, from: nil)
                    }
                    
                    Button("Quit") {
                        NSApp.terminate(nil)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .foregroundColor(.secondary)
                }
                .menuStyle(BorderlessButtonMenuStyle())
            }
            .padding()
            
            Divider()
            
            // Project List
            if projectMonitor.projects.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "ghost")
                        .font(.largeTitle)
                        .foregroundColor(.secondary)
                    Text("No Poltergeist instances running")
                        .foregroundColor(.secondary)
                    Text("Start Poltergeist in a project with:")
                        .font(.caption)
                        .foregroundColor(Color.secondary.opacity(0.7))
                    Text("poltergeist haunt")
                        .font(.system(.caption, design: .monospaced))
                        .foregroundColor(Color.secondary.opacity(0.7))
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding()
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(projectMonitor.projects) { project in
                            ProjectRowView(project: project) {
                                selectedProject = project
                            }
                        }
                    }
                    .padding()
                }
            }
        }
        .frame(width: 400, height: 500)
        .background(Color(NSColor.controlBackgroundColor))
        .sheet(item: $selectedProject) { project in
            ProjectDetailView(project: project, projectMonitor: projectMonitor)
        }
    }
}

struct ProjectRowView: View {
    let project: Project
    let onTap: () -> Void
    
    var statusIcon: some View {
        Image(systemName: project.overallStatus.icon)
            .foregroundColor(Color(project.overallStatus.color))
    }
    
    var body: some View {
        Button(action: onTap) {
            HStack {
                statusIcon
                    .frame(width: 20)
                
                VStack(alignment: .leading, spacing: 4) {
                    Text(project.name)
                        .font(.system(.body, design: .rounded))
                        .fontWeight(.medium)
                    
                    HStack(spacing: 12) {
                        ForEach(project.sortedTargets, id: \.key) { target, state in
                            TargetBadge(name: target, state: state)
                        }
                    }
                }
                
                Spacer()
                
                Image(systemName: "chevron.right")
                    .foregroundColor(.secondary)
                    .font(.caption)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Color(NSColor.controlColor))
            .cornerRadius(6)
            .contentShape(Rectangle())
        }
        .buttonStyle(PlainButtonStyle())
        .contextMenu {
            Button("View Full Error") {
                onTap()
            }
            .disabled(project.overallStatus != .failed)
            
            Button("Open Project Folder") {
                NSWorkspace.shared.open(URL(fileURLWithPath: project.path))
            }
            
            Divider()
            
            Button("Remove from Monitor", role: .destructive) {
                ProjectMonitor.shared.removeProject(project)
            }
        }
    }
}

struct TargetBadge: View {
    let name: String
    let state: TargetState
    
    var statusColor: Color {
        if !state.isActive { return .gray }
        
        switch state.lastBuild?.status {
        case "failed": return .red
        case "success": return .green
        case "building": return .blue
        default: return .gray
        }
    }
    
    var statusIcon: String {
        if !state.isActive { return "circle" }
        
        switch state.lastBuild?.status {
        case "failed": return "xmark.circle.fill"
        case "success": return "checkmark.circle.fill"
        case "building": return "arrow.triangle.2.circlepath"
        default: return "circle.dotted"
        }
    }
    
    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: statusIcon)
                .font(.caption2)
            Text(name)
                .font(.caption)
        }
        .foregroundColor(statusColor)
        .padding(.horizontal, 8)
        .padding(.vertical, 2)
        .background(statusColor.opacity(0.1))
        .cornerRadius(4)
    }
}

struct ProjectDetailView: View {
    let project: Project
    let projectMonitor: ProjectMonitor
    @Environment(\.dismiss) var dismiss
    
    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Image(systemName: "folder.fill")
                    .foregroundColor(.secondary)
                Text(project.name)
                    .font(.title2)
                    .fontWeight(.semibold)
                Spacer()
                Button("Done") {
                    dismiss()
                }
            }
            .padding()
            
            Divider()
            
            // Project Info
            VStack(alignment: .leading, spacing: 12) {
                Label(project.path, systemImage: "folder")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                // Target Details
                ForEach(project.sortedTargets, id: \.key) { target, state in
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text(target)
                                .font(.headline)
                            Spacer()
                            if state.isActive {
                                Label("Active", systemImage: "circle.fill")
                                    .foregroundColor(.green)
                                    .font(.caption)
                            } else {
                                Label("Inactive", systemImage: "circle")
                                    .foregroundColor(.gray)
                                    .font(.caption)
                            }
                        }
                        
                        if let build = state.lastBuild {
                            HStack {
                                Label(build.status.capitalized, systemImage: build.status == "success" ? "checkmark.circle" : "xmark.circle")
                                    .foregroundColor(build.status == "success" ? .green : .red)
                                
                                if let buildTime = build.buildTime {
                                    Text("(\(String(format: "%.1fs", buildTime)))")
                                        .foregroundColor(.secondary)
                                }
                                
                                Spacer()
                                
                                Text(build.timestamp, style: .relative)
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                            }
                            .font(.caption)
                            
                            if let error = build.errorSummary {
                                Text(error)
                                    .font(.system(.caption, design: .monospaced))
                                    .foregroundColor(.red)
                                    .padding(8)
                                    .background(Color.red.opacity(0.1))
                                    .cornerRadius(4)
                                    .textSelection(.enabled)
                            }
                        }
                    }
                    .padding()
                    .background(Color(NSColor.controlColor))
                    .cornerRadius(8)
                }
            }
            .padding()
            
            Spacer()
        }
        .frame(width: 500, height: 400)
        .background(Color(NSColor.controlBackgroundColor))
    }
}