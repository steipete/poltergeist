//
//  ProjectMonitor.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import Foundation
import os.log

/// The main project monitoring service for the Poltergeist macOS app.
///
/// `ProjectMonitor` is responsible for discovering, monitoring, and managing the state
/// of all active Poltergeist CLI instances. It watches the state directory for changes
/// and provides real-time updates about build status, project activity, and build queues.
///
/// ## Key Features
/// 
/// - **State Discovery**: Automatically discovers active Poltergeist instances by scanning state files
/// - **Real-time Monitoring**: Watches for file system changes in the state directory
/// - **Build Queue Management**: Tracks active, queued, and completed builds across all projects
/// - **Build Statistics**: Maintains build history and performance metrics
/// - **Lifecycle Management**: Handles cleanup of stale projects and processes
///
/// ## Usage
///
/// The ProjectMonitor is typically used as a singleton throughout the app:
///
/// ```swift
/// let monitor = ProjectMonitor.shared
/// monitor.startMonitoring()
/// 
/// // Access current projects
/// for project in monitor.projects {
///     print("Project: \(project.name) - Status: \(project.overallStatus)")
/// }
/// ```
///
/// ## Thread Safety
///
/// This class is marked with `@MainActor` and should only be accessed from the main thread.
/// All public methods and properties are safe to access from SwiftUI views and other
/// main-thread contexts.
@MainActor
@Observable
final class ProjectMonitor {
    static let shared = ProjectMonitor()
    static let projectsDidUpdateNotification = Notification.Name("ProjectsDidUpdate")

    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "ProjectMonitor")
    private let poltergeistDirectory: String = {
        if let customDir = ProcessInfo.processInfo.environment["POLTERGEIST_STATE_DIR"] {
            return customDir
        }
        return FileManager.default.temporaryDirectory.appendingPathComponent("poltergeist").path
    }()

    private(set) var projects: [Project] = []
    private(set) var buildQueue = BuildQueueInfo(
        queuedBuilds: [],
        activeBuilds: [],
        recentBuilds: []
    )

    private var fileWatcher: FileWatcher?
    private var updateTimer: Timer?
    private var debounceTimer: Timer?

    // Track build history for enhanced features
    private var buildHistory: [CompletedBuild] = []
    private let maxHistorySize = 50

    // Debouncing to avoid excessive scans
    private let debounceInterval: TimeInterval = 1.0

    // Build state debouncing to prevent UI flicker
    private var lastBuildQueueUpdate: Date = Date.distantPast
    private let buildStateDebounceInterval: TimeInterval = 2.0
    private var previousBuildQueue: BuildQueueInfo?

    // Prevent concurrent scans
    private var isScanning: Bool = false

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
            // Debounce rapid file changes to avoid excessive scanning
            self?.debouncedScanForProjects()
        }
        fileWatcher?.start()
    }

    private func debouncedScanForProjects() {
        // Cancel any pending scan
        debounceTimer?.invalidate()

        // Schedule a new scan after the debounce interval
        debounceTimer = Timer.scheduledTimer(withTimeInterval: debounceInterval, repeats: false) {
            [weak self] _ in
            Task { @MainActor in
                self?.scanForProjects()
            }
        }
    }

    private func scanForProjects() {
        // Prevent concurrent scans to avoid race conditions
        guard !isScanning else {
            logger.debug("⏸️ Scan already in progress, skipping")
            return
        }

        isScanning = true
        defer { isScanning = false }

        logger.info("🔍 Starting project scan in \(self.poltergeistDirectory)")

        do {
            let fileManager = FileManager.default
            let files = try fileManager.contentsOfDirectory(atPath: poltergeistDirectory)
            logger.debug("Found \(files.count) files in directory")

            var projectMap: [String: Project] = [:]
            var stateFileCount = 0

            for file in files where file.hasSuffix(".state") {
                stateFileCount += 1
                if let project = processStateFile(file, projectMap: &projectMap) {
                    logger.debug("Successfully processed project: \(project.name)")
                }
            }

            logger.info(
                "✅ Processed \(stateFileCount) state files, found \(projectMap.count) projects")

            updateProjectsList(from: projectMap)
        } catch {
            logger.error("❌ Failed to scan directory: \(error.localizedDescription)")
        }
    }

    private func processStateFile(_ file: String, projectMap: inout [String: Project]) -> Project? {
        let filePath = "\(poltergeistDirectory)/\(file)"
        logger.debug("Processing state file: \(file)")

        do {
            let data = try Data(contentsOf: URL(fileURLWithPath: filePath))
            let state = try JSONDecoder().decode(PoltergeistState.self, from: data)

            logStateInfo(state)

            guard let parsedInfo = parseStateFileName(file) else {
                return nil
            }

            let projectKey = "\(state.projectPath)-\(parsedInfo.hash)"

            // Create or update project
            var project =
                projectMap[projectKey]
                ?? Project(
                    path: state.projectPath,
                    name: state.projectName,
                    hash: parsedInfo.hash
                )

            let targetState = createTargetState(from: state)
            updateBuildQueue(from: state, targetState: targetState)
            checkForStatusChangesAndNotify(project: project, state: state, targetState: targetState)

            project.targets[state.target] = targetState
            projectMap[projectKey] = project

            return project
        } catch {
            handleStateFileError(file: file, error: error)
            return nil
        }
    }

    private func logStateInfo(_ state: PoltergeistState) {
        logger.info("📄 Loaded state for project: \(state.projectName), target: \(state.target)")
        logger.debug("  PID: \(state.process.pid), Active: \(state.process.isActive)")
        logger.debug("  Last heartbeat: \(state.process.lastHeartbeat)")
        if let build = state.lastBuild {
            logger.debug("  Build status: \(build.status)")
        }
    }

    private func parseStateFileName(_ file: String) -> (
        hash: String, projectName: String, targetName: String
    )? {
        // Format: projectName-hash-target.state (hash is always 8 hex chars)
        let fileWithoutExtension = String(file.dropLast(6))  // Remove .state
        logger.debug("📝 Parsing state file: \(file)")

        // Find the 8-character hex hash using regex
        let hashPattern = #"-([a-f0-9]{8})-"#
        guard let regex = try? NSRegularExpression(pattern: hashPattern, options: []),
            let match = regex.firstMatch(
                in: fileWithoutExtension,
                options: [],
                range: NSRange(location: 0, length: fileWithoutExtension.count))
        else {
            logger.warning("Invalid state file name format: \(file) (no 8-char hash found)")
            return nil
        }

        guard let hashRange = Range(match.range(at: 1), in: fileWithoutExtension) else {
            logger.warning("Invalid hash range in state file: \(file)")
            return nil
        }
        let projectHash = String(fileWithoutExtension[hashRange])

        // Extract project name (everything before -hash-)
        guard let hashStartRange = Range(match.range(at: 0), in: fileWithoutExtension) else {
            logger.warning("Invalid hash start range in state file: \(file)")
            return nil
        }
        let projectName = String(fileWithoutExtension[..<hashStartRange.lowerBound])

        // Extract target name (everything after -hash-)
        let hashEndIndex = hashStartRange.upperBound
        let targetName = String(fileWithoutExtension[hashEndIndex...])

        logger.debug(
            "📝 Parsed - Project: \(projectName), Hash: \(projectHash), Target: \(targetName)")
        return (hash: projectHash, projectName: projectName, targetName: targetName)
    }

    private func createTargetState(from state: PoltergeistState) -> TargetState {
        let heartbeat = ISO8601DateFormatter().date(from: state.process.lastHeartbeat)
        let isStale = isProcessStale(heartbeat: heartbeat)
        if isStale {
            logger.warning("⚠️ Process is stale for \(state.projectName):\(state.target)")
        }

        let icon = IconLoader.shared.loadIcon(from: state, projectPath: state.projectPath)

        return TargetState(
            target: state.target,
            isActive: state.process.isActive && !isProcessStale(heartbeat: heartbeat),
            lastHeartbeat: heartbeat,
            lastBuild: state.lastBuild.map { build in
                let buildTimestamp = ISO8601DateFormatter().date(from: build.timestamp)
                let buildStartTime = build.startTime.flatMap {
                    ISO8601DateFormatter().date(from: $0)
                }

                return BuildInfo(
                    status: build.status,
                    timestamp: buildTimestamp ?? Date(),
                    errorSummary: build.errorSummary?.isEmpty == true ? nil : build.errorSummary,
                    buildTime: build.buildTime,
                    gitHash: build.gitHash,
                    startTime: buildStartTime
                )
            },
            icon: icon
        )
    }

    private func checkForStatusChangesAndNotify(
        project: Project, state: PoltergeistState, targetState: TargetState
    ) {
        if let existingProject = projects.first(where: { $0.path == state.projectPath }),
            let existingTarget = existingProject.targets[state.target],
            let newStatus = targetState.lastBuild?.status,
            existingTarget.lastBuild?.status != newStatus
        {
            NotificationManager.shared.notifyBuildStatusChange(
                project: project,
                target: state.target,
                newStatus: newStatus,
                errorSummary: targetState.lastBuild?.errorSummary
            )
        }
    }

    private func handleStateFileError(file: String, error: Error) {
        // Skip logging errors for obviously invalid test files to reduce noise
        if file.hasPrefix("test-") || file.hasPrefix("main-queue-test-") {
            logger.debug("Skipping invalid test file: \(file)")
            return
        }

        switch error {
        case DecodingError.dataCorrupted:
            logger.warning("❌ Invalid JSON in state file: \(file)")
        case DecodingError.keyNotFound(let key, _):
            logger.warning("❌ Missing key '\(key.stringValue)' in state file: \(file)")
        case DecodingError.typeMismatch(let type, _):
            logger.warning("❌ Type mismatch for \(type) in state file: \(file)")
        case DecodingError.valueNotFound(let type, _):
            logger.warning("❌ Missing value for \(type) in state file: \(file)")
        default:
            logger.warning("❌ Failed to process state file \(file): \(error.localizedDescription)")
        }
    }

    private func updateProjectsList(from projectMap: [String: Project]) {
        let oldProjectCount = projects.count
        projects = Array(projectMap.values).sorted { $0.name < $1.name }

        if projects.count != oldProjectCount {
            logger.info("📊 Project count changed: \(oldProjectCount) → \(self.projects.count)")
        }

        // Clean up build queue when projects are removed
        cleanBuildQueueForRemovedProjects()

        NotificationCenter.default.post(name: Self.projectsDidUpdateNotification, object: nil)
    }

    private func isProcessStale(heartbeat: Date?) -> Bool {
        guard let heartbeat = heartbeat else { return true }
        // Use same staleness threshold as CLI (5 minutes = 300 seconds)
        return Date().timeIntervalSince(heartbeat) > 300
    }

    private func cleanBuildQueueForRemovedProjects() {
        let currentProjectNames = Set(projects.map { $0.name })

        // Filter out active builds for projects that no longer exist
        let activeBuilds = buildQueue.activeBuilds.filter { build in
            currentProjectNames.contains(build.project)
        }

        // Filter out queued builds for projects that no longer exist
        let queuedBuilds = buildQueue.queuedBuilds.filter { build in
            currentProjectNames.contains(build.project)
        }

        // Filter out recent builds for projects that no longer exist (keep some history)
        let recentBuilds = buildQueue.recentBuilds.filter { build in
            currentProjectNames.contains(build.project)
        }

        // Update build queue if anything changed
        let originalActiveCount = buildQueue.activeBuilds.count
        let originalQueuedCount = buildQueue.queuedBuilds.count
        let originalRecentCount = buildQueue.recentBuilds.count

        if activeBuilds.count != originalActiveCount || queuedBuilds.count != originalQueuedCount
            || recentBuilds.count != originalRecentCount
        {
            logger.info(
                "🧹 Cleaning build queue: active \(originalActiveCount)→\(activeBuilds.count), queued \(originalQueuedCount)→\(queuedBuilds.count), recent \(originalRecentCount)→\(recentBuilds.count)"
            )

            buildQueue = BuildQueueInfo(
                queuedBuilds: queuedBuilds,
                activeBuilds: activeBuilds,
                recentBuilds: recentBuilds
            )

            // Also clean build history
            buildHistory = buildHistory.filter { build in
                currentProjectNames.contains(build.project)
            }
        }
    }

    func removeProject(_ project: Project) {
        logger.info("🗑️ Removing project: \(project.name) (hash: \(project.hash))")
        logger.info("📁 Project path: \(project.path)")
        logger.info("🎯 Targets to remove: \(project.targets.keys.joined(separator: ", "))")

        // First, list all files in the directory for debugging
        do {
            let allFiles = try FileManager.default.contentsOfDirectory(atPath: poltergeistDirectory)
            let projectFiles = allFiles.filter {
                $0.contains(project.name) && $0.hasSuffix(".state")
            }
            logger.info(
                "📂 All state files for project '\(project.name)': \(projectFiles.joined(separator: ", "))"
            )

            // Also show files that match the hash
            let hashFiles = allFiles.filter { $0.contains(project.hash) && $0.hasSuffix(".state") }
            logger.info(
                "📂 All state files with hash '\(project.hash)': \(hashFiles.joined(separator: ", "))"
            )
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
                        "\(project.name).\(project.hash).\(targetName).state",
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
                logger.error(
                    "❌ Failed to remove state file \(fileName): \(error.localizedDescription)")
                logger.error("❌ Error details: \(error)")
                failedCount += 1
            }
        }

        logger.info("📊 Removal complete: \(removedCount) removed, \(failedCount) failed")

        // Rescan after a small delay to ensure filesystem operations complete
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(100))
            await MainActor.run {
                self?.logger.info("🔄 Triggering rescan after removal...")
                self?.scanForProjects()
            }
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

        // Ensure build queue is cleaned after removing projects
        Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            await MainActor.run {
                self?.cleanBuildQueueForRemovedProjects()
            }
        }
    }

    func refreshProjects() {
        logger.info("Refreshing projects...")
        Task { @MainActor in
            self.scanForProjects()
        }
    }

    // MARK: - Build Queue Management

    private func updateBuildQueue(from state: PoltergeistState, targetState: TargetState) {
        let projectName = state.projectName
        let targetName = state.target

        // Track active builds
        var activeBuilds = buildQueue.activeBuilds
        if let build = targetState.lastBuild, build.isBuilding {
            // Update or add active build
            if let existingIndex = activeBuilds.firstIndex(where: {
                $0.target == targetName && $0.project == projectName
            }) {
                // Update existing active build
                activeBuilds[existingIndex] = ActiveBuild(
                    target: targetName,
                    project: projectName,
                    startedAt: build.startTime ?? build.timestamp,
                    estimatedDuration: state.lastBuild?.estimatedDuration,
                    progress: build.buildProgress,
                    currentPhase: state.lastBuild?.currentPhase
                )
            } else {
                // Add new active build
                activeBuilds.append(
                    ActiveBuild(
                        target: targetName,
                        project: projectName,
                        startedAt: build.startTime ?? build.timestamp,
                        estimatedDuration: state.lastBuild?.estimatedDuration,
                        progress: build.buildProgress,
                        currentPhase: state.lastBuild?.currentPhase
                    ))
            }
        } else {
            // Remove from active builds if no longer building
            activeBuilds.removeAll { $0.target == targetName && $0.project == projectName }

            // Add to completed builds if we have build info
            if let build = targetState.lastBuild {
                addCompletedBuild(
                    target: targetName,
                    project: projectName,
                    build: build
                )
            }
        }

        // Create new build queue
        let newBuildQueue = BuildQueueInfo(
            queuedBuilds: buildQueue.queuedBuilds,  // TODO: Parse queue info from state files
            activeBuilds: activeBuilds,
            recentBuilds: Array(buildHistory.prefix(10))  // Show 10 most recent
        )

        // Apply debounced build queue update to prevent UI flicker
        updateBuildQueueWithDebouncing(newBuildQueue)
    }

    private func updateBuildQueueWithDebouncing(_ newBuildQueue: BuildQueueInfo) {
        let now = Date()

        // Check if this is a significant change worth updating immediately
        let hasSignificantChange = buildQueueHasSignificantChange(
            from: buildQueue, to: newBuildQueue)

        // If there's a significant change or enough time has passed, update immediately
        if hasSignificantChange
            || now.timeIntervalSince(lastBuildQueueUpdate) >= buildStateDebounceInterval
        {
            buildQueue = newBuildQueue
            previousBuildQueue = newBuildQueue
            lastBuildQueueUpdate = now
            logger.debug(
                "🔄 Build queue updated - Active: \(newBuildQueue.activeBuilds.count), Recent: \(newBuildQueue.recentBuilds.count)"
            )
        } else {
            // Minor change within debounce period - ignore to prevent flicker
            logger.debug("⏸️ Build queue update debounced - preventing flicker")
        }
    }

    private func buildQueueHasSignificantChange(from old: BuildQueueInfo, to new: BuildQueueInfo)
        -> Bool
    {
        // Significant changes that should update immediately:
        // 1. Number of active builds changed (most important for UI)
        // 2. First time seeing any build activity
        // 3. All activity stopped

        let activeCountChanged = old.activeBuilds.count != new.activeBuilds.count
        let hadNoActivity = !old.hasActivity
        let hasNoActivity = !new.hasActivity

        return activeCountChanged || (hadNoActivity && new.hasActivity)
            || (old.hasActivity && hasNoActivity)
    }

    private func addCompletedBuild(target: String, project: String, build: BuildInfo) {
        // Don't add duplicates
        let isDuplicate = buildHistory.contains { completedBuild in
            completedBuild.target == target && completedBuild.project == project
                && abs(completedBuild.completedAt.timeIntervalSince(build.timestamp)) < 1.0
        }

        if !isDuplicate {
            let completedBuild = CompletedBuild(
                target: target,
                project: project,
                startedAt: build.startTime ?? build.timestamp,
                completedAt: build.timestamp,
                status: build.status,
                duration: build.buildTime ?? 0,
                errorSummary: build.errorSummary,
                gitHash: build.gitHash
            )

            buildHistory.insert(completedBuild, at: 0)

            // Limit history size
            if buildHistory.count > maxHistorySize {
                buildHistory = Array(buildHistory.prefix(maxHistorySize))
            }

            logger.debug("Added completed build: \(project):\(target) - \(build.status)")
        }
    }

    // MARK: - Build Statistics

    func getBuildStatistics() -> BuildStatistics {
        let now = Date()
        let last24Hours = now.addingTimeInterval(-24 * 60 * 60)
        let recentBuilds = buildHistory.filter { $0.completedAt > last24Hours }

        let successful = recentBuilds.filter { $0.wasSuccessful }.count
        let failed = recentBuilds.count - successful
        let averageDuration =
            recentBuilds.isEmpty
            ? 0 : recentBuilds.map { $0.duration }.reduce(0, +) / Double(recentBuilds.count)

        return BuildStatistics(
            totalBuilds24h: recentBuilds.count,
            successfulBuilds24h: successful,
            failedBuilds24h: failed,
            averageBuildTime: averageDuration,
            currentActiveBuilds: buildQueue.activeBuilds.count,
            queueLength: buildQueue.totalQueueLength
        )
    }
}

// Build statistics for dashboard display
struct BuildStatistics {
    let totalBuilds24h: Int
    let successfulBuilds24h: Int
    let failedBuilds24h: Int
    let averageBuildTime: TimeInterval
    let currentActiveBuilds: Int
    let queueLength: Int

    var successRate: Double {
        totalBuilds24h == 0 ? 1.0 : Double(successfulBuilds24h) / Double(totalBuilds24h)
    }
}
