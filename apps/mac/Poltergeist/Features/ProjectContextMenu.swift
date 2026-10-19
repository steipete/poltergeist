//
//  ProjectContextMenu.swift
//  Poltergeist
//

import SwiftUI

struct ProjectContextMenu: View {
    let project: Project
    let projectMonitor: ProjectMonitor

    var body: some View {
        Button {
            NSWorkspace.shared.open(URL(fileURLWithPath: project.path))
        } label: {
            Label("Open in Finder", systemImage: "folder")
        }

        Button {
            NSWorkspace.shared.open(URL(fileURLWithPath: project.path))
        } label: {
            Label("Open in Terminal", systemImage: "terminal")
        }

        if project.overallStatus == .failed {
            Divider()

            Button {
                // Copy error to clipboard
                if let error = project.targets.values.compactMap({ $0.lastBuild?.errorSummary })
                    .first
                {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(error, forType: .string)
                }
            } label: {
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
