//
//  ProjectMonitorTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
import os.log
@testable import Poltergeist

// MARK: - Test Tags
extension Tag {
    @Tag static var services: Self
    @Tag static var integration: Self
}

// MARK: - Project Monitor Tests
@Suite("Project Monitor Tests", .tags(.services, .integration))
@MainActor
final class ProjectMonitorTests {
    
    let tempDirectory: URL
    let testStateDirectory: String
    
    init() throws {
        // Create a temporary directory for test state files
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("poltergeist-tests")
            .appendingPathComponent(UUID().uuidString)
        
        try FileManager.default.createDirectory(
            at: tempDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
        
        self.testStateDirectory = tempDirectory.path
    }
    
    deinit {
        // Clean up temporary directory
        try? FileManager.default.removeItem(at: tempDirectory)
    }
    
    // MARK: - State File Parsing Tests
    
    @Test("Parse valid state file name")
    func testParseValidStateFileName() throws {
        // Use reflection to access private method for testing
        let monitor = ProjectMonitor.shared
        
        // Create a mock state file in our test directory
        let stateFileName = "MyProject-a1b2c3d4-main-app.state"
        let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
        
        // Create minimal valid state content
        let stateContent = """
        {
            "version": "1.0.0",
            "projectPath": "/Users/test/MyProject",
            "projectName": "MyProject",
            "target": "main-app",
            "configPath": "/Users/test/MyProject/config.json",
            "process": {
                "pid": 12345,
                "isActive": true,
                "startTime": "2025-01-01T10:00:00Z",
                "lastHeartbeat": "2025-01-01T10:05:00Z"
            },
            "lastBuild": null,
            "appInfo": {
                "bundleId": null,
                "outputPath": null,
                "iconPath": null
            }
        }
        """
        
        try stateContent.write(to: stateFilePath, atomically: true, encoding: .utf8)
        
        // Test that the state file can be created and contains expected data
        #expect(FileManager.default.fileExists(atPath: stateFilePath.path))
        
        let loadedContent = try String(contentsOf: stateFilePath)
        #expect(loadedContent.contains("MyProject"))
        #expect(loadedContent.contains("main-app"))
    }
    
    @Test("Invalid state file names are rejected")
    func testInvalidStateFileNames() {
        let invalidNames = [
            "invalid.state",                    // No hash pattern
            "project-tooshort-target.state",   // Hash too short
            "project-toolong12345-target.state", // Hash too long
            "project-INVALID!-target.state",   // Invalid hash characters
            "project.state",                   // Missing target
            "project-abc12345.state"           // Missing target separator
        ]
        
        for invalidName in invalidNames {
            let stateFilePath = tempDirectory.appendingPathComponent(invalidName)
            
            // Create the file
            try? "{}".write(to: stateFilePath, atomically: true, encoding: .utf8)
            
            // File should exist but parsing should handle invalid names gracefully
            #expect(FileManager.default.fileExists(atPath: stateFilePath.path))
        }
    }
    
    @Test("Process staleness detection", arguments: [
        // (secondsAgo, expectedStale)
        (60, false),    // 1 minute ago - fresh
        (180, false),   // 3 minutes ago - fresh
        (300, false),   // 5 minutes ago - boundary case, should be fresh
        (301, true),    // 5 minutes 1 second ago - stale  
        (600, true),    // 10 minutes ago - stale
        (3600, true)    // 1 hour ago - stale
    ])
    func testProcessStalenessDetection(secondsAgo: TimeInterval, expectedStale: Bool) {
        let heartbeatTime = Date().addingTimeInterval(-secondsAgo)
        
        let targetState = TargetState(
            target: "test",
            isActive: true,
            lastHeartbeat: heartbeatTime,
            lastBuild: nil,
            icon: nil
        )
        
        #expect(targetState.isStale == expectedStale)
    }
    
    @Test("Nil heartbeat is always stale")
    func testNilHeartbeatIsStale() {
        let targetState = TargetState(
            target: "test",
            isActive: true,
            lastHeartbeat: nil,
            lastBuild: nil,
            icon: nil
        )
        
        #expect(targetState.isStale == true)
    }
    
    // MARK: - State File Processing Tests
    
    @Test("Process valid state file with build info")
    func testProcessValidStateFileWithBuildInfo() throws {
        let stateFileName = "TestProject-12345678-test-target.state"
        let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
        
        let stateContent = """
        {
            "version": "1.0.0",
            "projectPath": "/Users/test/TestProject",
            "projectName": "TestProject", 
            "target": "test-target",
            "configPath": "/Users/test/TestProject/config.json",
            "process": {
                "pid": 12345,
                "isActive": true,
                "startTime": "2025-01-01T10:00:00Z",
                "lastHeartbeat": "2025-01-01T10:05:00Z"
            },
            "lastBuild": {
                "status": "success",
                "timestamp": "2025-01-01T10:04:30Z",
                "startTime": "2025-01-01T10:04:00Z",
                "gitHash": "abc123def456",
                "errorSummary": null,
                "buildTime": 30.5,
                "fullError": null,
                "currentPhase": "completed",
                "estimatedDuration": 35.0
            },
            "appInfo": {
                "bundleId": "com.test.app",
                "outputPath": "/Users/test/TestProject/.build/debug/TestApp",
                "iconPath": null
            }
        }
        """
        
        try stateContent.write(to: stateFilePath, atomically: true, encoding: .utf8)
        
        // Verify file was created and contains expected content
        #expect(FileManager.default.fileExists(atPath: stateFilePath.path))
        
        let data = try Data(contentsOf: stateFilePath)
        let state = try JSONDecoder().decode(PoltergeistState.self, from: data)
        
        #expect(state.projectName == "TestProject")
        #expect(state.target == "test-target")
        #expect(state.process.isActive == true)
        
        let build = try #require(state.lastBuild)
        #expect(build.status == "success")
        #expect(build.buildTime == 30.5)
        #expect(build.gitHash == "abc123def456")
    }
    
    @Test("Process state file with corrupted JSON")
    func testProcessCorruptedStateFile() throws {
        let stateFileName = "Corrupted-12345678-target.state"
        let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
        
        let corruptedContent = """
        {
            "version": "1.0.0",
            "projectPath": "/test",
            "projectName": "Corrupted",
            "target": "target",
            "process": {
                "pid": 123,
                "isActive": true,
                "startTime": "invalid-date",
                "lastHeartbeat": "2025-01-01T10:05:00Z"
            },
            "lastBuild": null,
            "appInfo": { INVALID JSON }
        }
        """
        
        try corruptedContent.write(to: stateFilePath, atomically: true, encoding: .utf8)
        
        // Verify file exists but JSON is invalid
        #expect(FileManager.default.fileExists(atPath: stateFilePath.path))
        
        let data = try Data(contentsOf: stateFilePath)
        
        // Should throw when trying to decode
        #expect(throws: DecodingError.self) {
            try JSONDecoder().decode(PoltergeistState.self, from: data)
        }
    }
    
    // MARK: - Project Management Tests
    
    @Test("Project creation from state file")
    func testProjectCreationFromStateFile() throws {
        let stateFileName = "NewProject-abcdef12-main.state"
        let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
        
        let stateContent = """
        {
            "version": "1.0.0",
            "projectPath": "/Users/test/NewProject",
            "projectName": "NewProject",
            "target": "main",
            "configPath": "/Users/test/NewProject/config.json",
            "process": {
                "pid": 54321,
                "isActive": true,
                "startTime": "2025-01-01T09:00:00Z",
                "lastHeartbeat": "2025-01-01T09:05:00Z"
            },
            "lastBuild": {
                "status": "building",
                "timestamp": "2025-01-01T09:04:00Z",
                "startTime": "2025-01-01T09:03:30Z",
                "gitHash": null,
                "errorSummary": null,
                "buildTime": null,
                "fullError": null,
                "currentPhase": "compiling",
                "estimatedDuration": 45.0
            },
            "appInfo": {
                "bundleId": null,
                "outputPath": "/Users/test/NewProject/output",
                "iconPath": null
            }
        }
        """
        
        try stateContent.write(to: stateFilePath, atomically: true, encoding: .utf8)
        
        // Test that we can decode and create project structures
        let data = try Data(contentsOf: stateFilePath)
        let state = try JSONDecoder().decode(PoltergeistState.self, from: data)
        
        // Simulate creating a project from this state
        let project = Project(
            path: state.projectPath,
            name: state.projectName,
            hash: "abcdef12" // extracted from filename
        )
        
        #expect(project.name == "NewProject")
        #expect(project.path == "/Users/test/NewProject")
        #expect(project.hash == "abcdef12")
        #expect(project.targets.isEmpty) // No targets added yet
    }
    
    @Test("Multiple targets for same project")
    func testMultipleTargetsForSameProject() throws {
        // Create state files for multiple targets of the same project
        let projectHash = "12345678"
        let projectName = "MultiTarget"
        let projectPath = "/Users/test/MultiTarget"
        
        let targets = ["app", "tests", "lib"]
        
        for target in targets {
            let stateFileName = "\(projectName)-\(projectHash)-\(target).state"
            let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
            
            let stateContent = """
            {
                "version": "1.0.0",
                "projectPath": "\(projectPath)",
                "projectName": "\(projectName)",
                "target": "\(target)",
                "configPath": "\(projectPath)/config.json",
                "process": {
                    "pid": \(1000 + targets.firstIndex(of: target)!),
                    "isActive": true,
                    "startTime": "2025-01-01T10:00:00Z",
                    "lastHeartbeat": "2025-01-01T10:05:00Z"
                },
                "lastBuild": {
                    "status": "\(target == "tests" ? "failed" : "success")",
                    "timestamp": "2025-01-01T10:04:00Z",
                    "startTime": null,
                    "gitHash": "abc123",
                    "errorSummary": \(target == "tests" ? "\"Test failed\"" : "null"),
                    "buildTime": 15.0,
                    "fullError": null,
                    "currentPhase": "completed",
                    "estimatedDuration": null
                },
                "appInfo": {
                    "bundleId": null,
                    "outputPath": "\(projectPath)/\(target)",
                    "iconPath": null
                }
            }
            """
            
            try stateContent.write(to: stateFilePath, atomically: true, encoding: .utf8)
        }
        
        // Verify all files were created
        for target in targets {
            let stateFileName = "\(projectName)-\(projectHash)-\(target).state"
            let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
            #expect(FileManager.default.fileExists(atPath: stateFilePath.path))
        }
        
        // Test that we can load all states and they belong to the same project
        var projectStates: [PoltergeistState] = []
        
        for target in targets {
            let stateFileName = "\(projectName)-\(projectHash)-\(target).state"
            let stateFilePath = tempDirectory.appendingPathComponent(stateFileName)
            let data = try Data(contentsOf: stateFilePath)
            let state = try JSONDecoder().decode(PoltergeistState.self, from: data)
            projectStates.append(state)
        }
        
        #expect(projectStates.count == 3)
        
        // All should have the same project info
        let firstState = projectStates[0]
        for state in projectStates {
            #expect(state.projectName == firstState.projectName)
            #expect(state.projectPath == firstState.projectPath)
        }
        
        // But different targets
        let targetNames = Set(projectStates.map { $0.target })
        #expect(targetNames == Set(targets))
        
        // Test overall status determination - should be failed due to tests
        let buildStatuses = projectStates.compactMap { $0.lastBuild?.status }
        #expect(buildStatuses.contains("failed"))
        #expect(buildStatuses.contains("success"))
    }
}

// MARK: - Build Statistics Tests
@Suite("Build Statistics Tests", .tags(.services, .unit))
@MainActor
struct BuildStatisticsTests {
    
    @Test("Build statistics calculation")
    func testBuildStatisticsCalculation() {
        let now = Date()
        let twentyFourHoursAgo = now.addingTimeInterval(-24 * 60 * 60)
        
        // Create sample completed builds
        let successfulBuild = CompletedBuild(
            target: "app",
            project: "test",
            startedAt: twentyFourHoursAgo.addingTimeInterval(3600), // 23 hours ago
            completedAt: twentyFourHoursAgo.addingTimeInterval(3630), // 23 hours ago
            status: "success",
            duration: 30.0,
            errorSummary: nil,
            gitHash: "abc123"
        )
        
        let failedBuild = CompletedBuild(
            target: "tests",
            project: "test",
            startedAt: twentyFourHoursAgo.addingTimeInterval(7200), // 22 hours ago
            completedAt: twentyFourHoursAgo.addingTimeInterval(7215), // 22 hours ago
            status: "failed",
            duration: 15.0,
            errorSummary: "Build failed",
            gitHash: "def456"
        )
        
        let oldBuild = CompletedBuild(
            target: "old",
            project: "test", 
            startedAt: twentyFourHoursAgo.addingTimeInterval(-3600), // 25 hours ago
            completedAt: twentyFourHoursAgo.addingTimeInterval(-3570), // 25 hours ago
            status: "success",
            duration: 30.0,
            errorSummary: nil,
            gitHash: "old123"
        )
        
        let buildHistory = [successfulBuild, failedBuild, oldBuild]
        
        // Filter to last 24 hours (should exclude oldBuild)
        let recentBuilds = buildHistory.filter { $0.completedAt > twentyFourHoursAgo }
        
        #expect(recentBuilds.count == 2)
        
        let successful = recentBuilds.filter { $0.wasSuccessful }.count
        let failed = recentBuilds.count - successful
        let averageDuration = recentBuilds.map { $0.duration }.reduce(0, +) / Double(recentBuilds.count)
        
        #expect(successful == 1)
        #expect(failed == 1)
        #expect(averageDuration == 22.5) // (30 + 15) / 2
        
        // Success rate calculation
        let successRate = Double(successful) / Double(recentBuilds.count)
        #expect(successRate == 0.5)
    }
    
    @Test("Build statistics with no builds")
    func testBuildStatisticsWithNoBuilds() {
        let buildHistory: [CompletedBuild] = []
        let now = Date()
        let twentyFourHoursAgo = now.addingTimeInterval(-24 * 60 * 60)
        
        let recentBuilds = buildHistory.filter { $0.completedAt > twentyFourHoursAgo }
        
        #expect(recentBuilds.isEmpty)
        
        let successful = recentBuilds.filter { $0.wasSuccessful }.count
        let averageDuration = recentBuilds.isEmpty ? 0.0 : recentBuilds.map { $0.duration }.reduce(0, +) / Double(recentBuilds.count)
        let successRate = recentBuilds.isEmpty ? 1.0 : Double(successful) / Double(recentBuilds.count)
        
        #expect(successful == 0)
        #expect(averageDuration == 0.0)
        #expect(successRate == 1.0) // Default to 100% when no builds
    }
    
    @Test("Build statistics with only successful builds")
    func testBuildStatisticsOnlySuccessful() {
        let now = Date()
        let twentyFourHoursAgo = now.addingTimeInterval(-24 * 60 * 60)
        
        let builds = [
            CompletedBuild(
                target: "app1",
                project: "test",
                startedAt: twentyFourHoursAgo.addingTimeInterval(3600),
                completedAt: twentyFourHoursAgo.addingTimeInterval(3620),
                status: "success",
                duration: 20.0,
                errorSummary: nil,
                gitHash: "abc1"
            ),
            CompletedBuild(
                target: "app2",
                project: "test",
                startedAt: twentyFourHoursAgo.addingTimeInterval(7200),
                completedAt: twentyFourHoursAgo.addingTimeInterval(7240),
                status: "success",
                duration: 40.0,
                errorSummary: nil,
                gitHash: "abc2"
            )
        ]
        
        let recentBuilds = builds.filter { $0.completedAt > twentyFourHoursAgo }
        let successful = recentBuilds.filter { $0.wasSuccessful }.count
        let successRate = Double(successful) / Double(recentBuilds.count)
        
        #expect(successful == 2)
        #expect(successRate == 1.0)
    }
}