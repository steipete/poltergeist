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
        logger.info("🔍 Starting project scan in \(self.poltergeistDirectory)")
        
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
                    // Format: projectName-hash-target.state (hash is always 8 hex chars)
                    let fileWithoutExtension = String(file.dropLast(6)) // Remove .state
                    
                    logger.debug("📝 Parsing state file: \(file)")
                    
                    // Find the 8-character hex hash using regex
                    let hashPattern = #"-([a-f0-9]{8})-"#
                    guard let regex = try? NSRegularExpression(pattern: hashPattern, options: []),
                          let match = regex.firstMatch(in: fileWithoutExtension, options: [], 
                                                     range: NSRange(location: 0, length: fileWithoutExtension.count)) else {
                        logger.warning("Invalid state file name format: \(file) (no 8-char hash found)")
                        continue
                    }
                    
                    let hashRange = Range(match.range(at: 1), in: fileWithoutExtension)!
                    let projectHash = String(fileWithoutExtension[hashRange])
                    
                    // Extract project name (everything before -hash-)
                    let hashStartRange = Range(match.range(at: 0), in: fileWithoutExtension)!
                    let projectName = String(fileWithoutExtension[..<hashStartRange.lowerBound])
                    
                    // Extract target name (everything after -hash-)
                    let hashEndIndex = hashStartRange.upperBound
                    let targetName = String(fileWithoutExtension[hashEndIndex...])
                    
                    logger.debug("📝 Parsed - Project: \(projectName), Hash: \(projectHash), Target: \(targetName)")
                    
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
                logger.info("📊 Project count changed: \(oldProjectCount) → \(self.projects.count)")
            }
            
            NotificationCenter.default.post(name: Self.projectsDidUpdateNotification, object: nil)
            
        } catch {
            logger.error("❌ Failed to scan directory: \(error.localizedDescription)")
        }
    }
    
    private func isProcessStale(heartbeat: Date?) -> Bool {
        guard let heartbeat = heartbeat else { return true }
        // Use same staleness threshold as CLI (5 minutes = 300 seconds)
        return Date().timeIntervalSince(heartbeat) > 300
    }
    
    func removeProject(_ project: Project) {
        logger.info("🗑️ Removing project: \(project.name) (hash: \(project.hash))")
        logger.info("📁 Project path: \(project.path)")
        logger.info("🎯 Targets to remove: \(project.targets.keys.joined(separator: ", "))")
        
        // First, list all files in the directory for debugging
        do {
            let allFiles = try FileManager.default.contentsOfDirectory(atPath: poltergeistDirectory)
            let projectFiles = allFiles.filter { $0.contains(project.name) && $0.hasSuffix(".state") }
            logger.info("📂 All state files for project '\(project.name)': \(projectFiles.joined(separator: ", "))")
            
            // Also show files that match the hash
            let hashFiles = allFiles.filter { $0.contains(project.hash) && $0.hasSuffix(".state") }
            logger.info("📂 All state files with hash '\(project.hash)': \(hashFiles.joined(separator: ", "))")
        } catch {
            logger.error("❌ Failed to list directory contents: \(error.localizedDescription)")
        }
        
        var removedCount = 0
        var failedCount = 0
        
        // Remove all state files for this project
        for (targetName, _) in project.targets {
            let fileName = "\(project.name)-\(project.hash)-\(targetName).state"
            let filePath = "\(poltergeistDirectory)/\(fileName)"
            
            logger.info("🔍 Looking for file: \(fileName)")
            logger.debug("🔍 Full path: \(filePath)")
            
            do {
                if FileManager.default.fileExists(atPath: filePath) {
                    logger.info("✅ File exists, attempting removal...")
                    try FileManager.default.removeItem(atPath: filePath)
                    logger.info("✅ Successfully removed state file: \(fileName)")
                    removedCount += 1
                } else {
                    logger.warning("⚠️ State file not found: \(fileName)")
                    
                    // Try alternative naming patterns
                    let alternativePatterns = [
                        "\(project.name)-\(targetName)-\(project.hash).state",
                        "\(project.name)_\(project.hash)_\(targetName).state",
                        "\(project.name).\(project.hash).\(targetName).state"
                    ]
                    
                    for pattern in alternativePatterns {
                        let altPath = "\(poltergeistDirectory)/\(pattern)"
                        if FileManager.default.fileExists(atPath: altPath) {
                            logger.info("🔄 Found file with alternative pattern: \(pattern)")
                            try FileManager.default.removeItem(atPath: altPath)
                            logger.info("✅ Removed alternative pattern file: \(pattern)")
                            removedCount += 1
                            break
                        }
                    }
                }
            } catch {
                logger.error("❌ Failed to remove state file \(fileName): \(error.localizedDescription)")
                logger.error("❌ Error details: \(error)")
                failedCount += 1
            }
        }
        
        logger.info("📊 Removal complete: \(removedCount) removed, \(failedCount) failed")
        
        // Rescan after a small delay to ensure filesystem operations complete
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
            self?.logger.info("🔄 Triggering rescan after removal...")
            self?.scanForProjects()
        }
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
