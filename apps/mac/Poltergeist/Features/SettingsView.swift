import SwiftUI

struct SettingsView: View {
    @ObservedObject var preferences = Preferences.shared
    @State private var selectedTab = "general"
    
    var body: some View {
        TabView(selection: $selectedTab) {
            GeneralSettingsView()
                .tabItem {
                    Label("General", systemImage: "gear")
                }
                .tag("general")
            
            NotificationSettingsView()
                .tabItem {
                    Label("Notifications", systemImage: "bell")
                }
                .tag("notifications")
            
            AdvancedSettingsView()
                .tabItem {
                    Label("Advanced", systemImage: "wrench.and.screwdriver")
                }
                .tag("advanced")
        }
        .frame(width: 500, height: 400)
    }
}

struct GeneralSettingsView: View {
    @ObservedObject var preferences = Preferences.shared
    
    var body: some View {
        Form {
            Section {
                Toggle("Launch at Login", isOn: $preferences.launchAtLogin)
                    .onChange(of: preferences.launchAtLogin) { oldValue, newValue in
                        LaunchAtLogin.shared.isEnabled = newValue
                    }
                
                Toggle("Show Build Time in Badges", isOn: $preferences.showBuildTimeInBadges)
                
                HStack {
                    Text("Status Check Interval:")
                    Picker("", selection: $preferences.statusCheckInterval) {
                        Text("1 second").tag(1.0)
                        Text("2 seconds").tag(2.0)
                        Text("5 seconds").tag(5.0)
                        Text("10 seconds").tag(10.0)
                    }
                    .pickerStyle(.segmented)
                }
                
                HStack {
                    Text("Auto-cleanup inactive projects after:")
                    Picker("", selection: $preferences.autoCleanupInactiveDays) {
                        Text("Never").tag(0)
                        Text("1 day").tag(1)
                        Text("3 days").tag(3)
                        Text("7 days").tag(7)
                        Text("30 days").tag(30)
                    }
                }
            }
        }
        .padding()
    }
}

struct NotificationSettingsView: View {
    @ObservedObject var preferences = Preferences.shared
    
    var body: some View {
        Form {
            Section {
                Toggle("Show Notifications", isOn: $preferences.showNotifications)
                
                Toggle("Only Notify on Build Failures", isOn: $preferences.notifyOnlyOnFailure)
                    .disabled(!preferences.showNotifications)
                
                Toggle("Play Sound", isOn: $preferences.soundEnabled)
                    .disabled(!preferences.showNotifications)
            }
            
            Section {
                Text("Notifications require permission from System Settings > Notifications")
                    .font(.caption)
                    .foregroundColor(.secondary)
                
                Button("Open System Settings") {
                    if let url = URL(string: "x-apple.systempreferences:com.apple.preference.notifications") {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
        }
        .padding()
    }
}

struct AdvancedSettingsView: View {
    @ObservedObject var preferences = Preferences.shared
    @State private var showingResetAlert = false
    
    var body: some View {
        Form {
            Section {
                HStack {
                    Text("Poltergeist Directory:")
                    Text("/tmp/poltergeist/")
                        .font(.system(.body, design: .monospaced))
                        .foregroundColor(.secondary)
                    
                    Button("Show in Finder") {
                        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: "/tmp/poltergeist/")
                    }
                }
                
                HStack {
                    Button("Clear Icon Cache") {
                        IconLoader.shared.clearCache()
                    }
                    
                    Button("Clean Up All Inactive Projects") {
                        ProjectMonitor.shared.cleanupInactiveProjects()
                    }
                }
            }
            
            Section {
                Button("Reset All Settings") {
                    showingResetAlert = true
                }
                .foregroundColor(.red)
            }
        }
        .padding()
        .alert("Reset All Settings?", isPresented: $showingResetAlert) {
            Button("Cancel", role: .cancel) { }
            Button("Reset", role: .destructive) {
                preferences.reset()
            }
        } message: {
            Text("This will reset all settings to their default values.")
        }
    }
}