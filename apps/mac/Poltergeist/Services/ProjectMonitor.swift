import Foundation
import Combine
import os.log

@MainActor
class ProjectMonitor: ObservableObject {
    static let shared = ProjectMonitor()
    static let projectsDidUpdateNotification = Notification.Name("ProjectsDidUpdate")
    
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "ProjectMonitor")
    private let poltergeistDirectory = "/tmp/poltergeist"
    
    @Published private(set) var projects: [Project] = []
    
    private var fileWatcher: FileWatcher?
    private var updateTimer: Timer?
    
    private init() {}
    
    func startMonitoring() {
        logger.info("Starting project monitoring...")
        
        // Create directory if it doesn't exist
        createPoltergeistDirectory()
        
        // Initial scan
        scanForProjects()
        
        // Set up file watching
        setupFileWatcher()
        
        // Set up periodic updates for heartbeat checks
        updateTimer = Timer.scheduledTimer(withTimeInterval: 5.0, repeats: true) { _ in
            Task { @MainActor in
                self.scanForProjects()
            }
        }
    }
    
    private func createPoltergeistDirectory() {
        do {
            try FileManager.default.createDirectory(
                atPath: poltergeistDirectory,
                withIntermediateDirectories: true,
                attributes: nil
            )
        } catch {
            logger.error("Failed to create directory: \(error.localizedDescription)")
        }
    }
    
    private func setupFileWatcher() {
        fileWatcher = FileWatcher(path: poltergeistDirectory) { [weak self] in
            Task { @MainActor in
                self?.scanForProjects()
            }
        }
        fileWatcher?.start()
    }
    
    private func scanForProjects() {
        logger.info("🔍 Starting project scan in \(poltergeistDirectory)")
        
        do {
            let fileManager = FileManager.default
            let files = try fileManager.contentsOfDirectory(atPath: poltergeistDirectory)
            logger.debug("Found \(files.count) files in directory")
            
            var projectMap: [String: Project] = [:]
            var stateFileCount = 0
            
            for file in files where file.hasSuffix(".state") {
                stateFileCount += 1
                let filePath = "\(poltergeistDirectory)/\(file)"
                logger.debug("Processing state file: \(file)")
                
                do {
                    let data = try Data(contentsOf: URL(fileURLWithPath: filePath))
                    let state = try JSONDecoder().decode(PoltergeistState.self, from: data)
                    
                    logger.info("📄 Loaded state for project: \(state.projectName), target: \(state.target)")
                    logger.debug("  PID: \(state.process.pid), Active: \(state.process.isActive)")
                    logger.debug("  Last heartbeat: \(state.process.lastHeartbeat)")
                    if let build = state.lastBuild {
                        logger.debug("  Build status: \(build.status)")
                    }
                    
                    // Extract project hash from filename
                    let components = file.dropLast(6).split(separator: "-") // Remove .state
                    guard components.count >= 3 else {
                        logger.warning("Invalid state file name format: \(file)")
                        continue
                    }
                    
                    let projectHash = String(components[components.count - 2])
                    let projectKey = "\(state.projectPath)-\(projectHash)"
                    
                    // Create or update project
                    var project = projectMap[projectKey] ?? Project(
                        path: state.projectPath,
                        name: state.projectName,
                        hash: projectHash
                    )
                    
                    // Update target state
                    let heartbeat = ISO8601DateFormatter().date(from: state.process.lastHeartbeat)
                    let buildTimestamp = state.lastBuild.map { ISO8601DateFormatter().date(from: $0.timestamp) } ?? nil
                    
                    let isStale = isProcessStale(heartbeat: heartbeat)
                    if isStale {
                        logger.warning("⚠️ Process is stale for \(state.projectName):\(state.target)")
                    }
                    
                    let icon = IconLoader.shared.loadIcon(from: state, projectPath: state.projectPath)
                    
                    let targetState = TargetState(
                        target: state.target,
                        isActive: state.process.isActive && !isProcessStale(heartbeat: heartbeat),
                        lastHeartbeat: heartbeat,
                        lastBuild: state.lastBuild.map { build in
                            BuildInfo(
                                status: build.status,
                                timestamp: buildTimestamp ?? Date(),
                                errorSummary: build.errorSummary?.isEmpty == true ? nil : build.errorSummary,
                                buildTime: build.buildTime,
                                gitHash: build.gitHash
                            )
                        },
                        icon: icon
                    )
                    
                    // Check for status changes and send notifications
                    if let existingProject = projects.first(where: { $0.path == state.projectPath }),
                       let existingTarget = existingProject.targets[state.target],
                       let newStatus = targetState.lastBuild?.status,
                       existingTarget.lastBuild?.status != newStatus {
                        NotificationManager.shared.notifyBuildStatusChange(
                            project: project,
                            target: state.target,
                            newStatus: newStatus,
                            errorSummary: targetState.lastBuild?.errorSummary
                        )
                    }
                    
                    project.targets[state.target] = targetState
                    projectMap[projectKey] = project
                    
                } catch DecodingError.dataCorrupted(let context) {
                    logger.error("❌ Failed to decode state file \(file): data corrupted - \(context.debugDescription)")
                } catch DecodingError.keyNotFound(let key, let context) {
                    logger.error("❌ Failed to decode state file \(file): missing key '\(key.stringValue)' - \(context.debugDescription)")
                } catch DecodingError.typeMismatch(let type, let context) {
                    logger.error("❌ Failed to decode state file \(file): type mismatch for \(type) - \(context.debugDescription)")
                } catch DecodingError.valueNotFound(let type, let context) {
                    logger.error("❌ Failed to decode state file \(file): value not found for \(type) - \(context.debugDescription)")
                } catch {
                    logger.error("❌ Failed to process state file \(file): \(error.localizedDescription)")
                }
            }
            
            logger.info("✅ Processed \(stateFileCount) state files, found \(projectMap.count) projects")
            
            let oldProjectCount = projects.count
            projects = Array(projectMap.values).sorted { $0.name < $1.name }
            
            if projects.count != oldProjectCount {
                logger.info("📊 Project count changed: \(oldProjectCount) → \(projects.count)")
            }
            
            NotificationCenter.default.post(name: Self.projectsDidUpdateNotification, object: nil)
            
        } catch {
            logger.error("❌ Failed to scan directory: \(error.localizedDescription)")
        }
    }
    
    private func isProcessStale(heartbeat: Date?) -> Bool {
        guard let heartbeat = heartbeat else { return true }
        return Date().timeIntervalSince(heartbeat) > 30
    }
    
    func removeProject(_ project: Project) {
        logger.info("Removing project: \(project.name)")
        
        // Remove all state files for this project
        for (targetName, _) in project.targets {
            let fileName = "\(project.name)-\(project.hash)-\(targetName).state"
            let filePath = "\(poltergeistDirectory)/\(fileName)"
            
            do {
                try FileManager.default.removeItem(atPath: filePath)
                logger.debug("Removed state file: \(fileName)")
            } catch {
                logger.error("Failed to remove state file: \(error.localizedDescription)")
            }
        }
        
        // Rescan
        scanForProjects()
    }
    
    func cleanupInactiveProjects() {
        logger.info("Cleaning up inactive projects...")
        
        let inactiveProjects = projects.filter { project in
            project.targets.values.allSatisfy { !$0.isActive }
        }
        
        for project in inactiveProjects {
            removeProject(project)
        }
    }
    
    func refreshProjects() {
        logger.info("Refreshing projects...")
        scanForProjects()
    }
}