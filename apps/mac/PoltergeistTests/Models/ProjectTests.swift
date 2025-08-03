//
//  ProjectTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
@testable import Poltergeist

// MARK: - Test Tags
extension Tag {
    @Tag static var models: Self
    @Tag static var fast: Self
    @Tag static var unit: Self
}

// MARK: - Project Model Tests
@Suite("Project Model Tests", .tags(.models, .fast, .unit))
struct ProjectTests {
    
    // MARK: - Basic Properties Tests
    
    @Test("Project initialization with basic properties")
    func testProjectInitialization() {
        let project = Project(
            path: "/Users/test/MyProject",
            name: "MyProject", 
            hash: "abc123ef"
        )
        
        #expect(project.path == "/Users/test/MyProject")
        #expect(project.name == "MyProject")
        #expect(project.hash == "abc123ef")
        #expect(project.id == "/Users/test/MyProject")
        #expect(project.targets.isEmpty)
    }
    
    @Test("Project equality comparison")
    func testProjectEquality() {
        let project1 = Project(path: "/test", name: "Test", hash: "abc123")
        let project2 = Project(path: "/test", name: "Test", hash: "abc123")
        let project3 = Project(path: "/other", name: "Test", hash: "abc123")
        
        #expect(project1 == project2)
        #expect(project1 != project3)
    }
    
    // MARK: - Target Management Tests
    
    @Test("Adding targets to project")
    func testAddingTargets() {
        var project = Project(path: "/test", name: "Test", hash: "hash")
        
        let target1 = TargetState(
            target: "app",
            isActive: true,
            lastHeartbeat: Date(),
            lastBuild: nil,
            icon: nil
        )
        
        let target2 = TargetState(
            target: "tests",
            isActive: false,
            lastHeartbeat: nil,
            lastBuild: nil,
            icon: nil
        )
        
        project.targets["app"] = target1
        project.targets["tests"] = target2
        
        #expect(project.targets.count == 2)
        #expect(project.targets["app"] == target1)
        #expect(project.targets["tests"] == target2)
    }
    
    @Test("Sorted targets maintains alphabetical order")
    func testSortedTargets() {
        var project = Project(path: "/test", name: "Test", hash: "hash")
        
        // Add targets in non-alphabetical order
        project.targets["zulu"] = TargetState(target: "zulu", isActive: true, lastHeartbeat: nil, lastBuild: nil, icon: nil)
        project.targets["alpha"] = TargetState(target: "alpha", isActive: true, lastHeartbeat: nil, lastBuild: nil, icon: nil)
        project.targets["charlie"] = TargetState(target: "charlie", isActive: true, lastHeartbeat: nil, lastBuild: nil, icon: nil)
        
        let sortedTargets = project.sortedTargets
        
        #expect(sortedTargets.count == 3)
        #expect(sortedTargets[0].key == "alpha")
        #expect(sortedTargets[1].key == "charlie")
        #expect(sortedTargets[2].key == "zulu")
    }
    
    // MARK: - Overall Status Tests
    
    @Test("Overall status determination", arguments: [
        // (targets, expectedStatus)
        ([], Project.BuildStatus.idle),
        (["success"], Project.BuildStatus.success),
        (["failed"], Project.BuildStatus.failed),
        (["building"], Project.BuildStatus.building),
        (["success", "success"], Project.BuildStatus.success),
        (["success", "failed"], Project.BuildStatus.failed),
        (["building", "success"], Project.BuildStatus.building),
        (["failed", "building"], Project.BuildStatus.failed)
    ])
    func testOverallStatus(targetStatuses: [String], expectedStatus: Project.BuildStatus) {
        var project = Project(path: "/test", name: "Test", hash: "hash")
        
        // Add targets with specified statuses
        for (index, status) in targetStatuses.enumerated() {
            let buildInfo = BuildInfo(
                status: status,
                timestamp: Date(),
                errorSummary: nil,
                buildTime: nil,
                gitHash: nil,
                startTime: nil
            )
            
            let targetState = TargetState(
                target: "target\(index)",
                isActive: true,
                lastHeartbeat: Date(),
                lastBuild: buildInfo,
                icon: nil
            )
            
            project.targets["target\(index)"] = targetState
        }
        
        #expect(project.overallStatus == expectedStatus)
    }
}

// MARK: - Build Status Tests
@Suite("Build Status Tests", .tags(.models, .fast))
struct BuildStatusTests {
    
    @Test("Build status icon mapping", arguments: [
        (Project.BuildStatus.idle, "circle.dotted"),
        (Project.BuildStatus.building, "arrow.triangle.2.circlepath"),
        (Project.BuildStatus.success, "checkmark.circle.fill"),
        (Project.BuildStatus.failed, "xmark.circle.fill")
    ])
    func testBuildStatusIcons(status: Project.BuildStatus, expectedIcon: String) {
        #expect(status.icon == expectedIcon)
    }
    
    @Test("Build status color mapping")
    func testBuildStatusColors() {
        #expect(Project.BuildStatus.idle.color == .systemGray)
        #expect(Project.BuildStatus.building.color == .systemBlue)
        #expect(Project.BuildStatus.success.color == .systemGreen)
        #expect(Project.BuildStatus.failed.color == .systemRed)
    }
}

// MARK: - Target State Tests
@Suite("Target State Tests", .tags(.models, .fast))
struct TargetStateTests {
    
    @Test("Target state initialization")
    func testTargetStateInitialization() {
        let now = Date()
        let buildInfo = BuildInfo(
            status: "success",
            timestamp: now,
            errorSummary: nil,
            buildTime: 2.5,
            gitHash: "abc123",
            startTime: nil
        )
        
        let targetState = TargetState(
            target: "my-app",
            isActive: true,
            lastHeartbeat: now,
            lastBuild: buildInfo,
            icon: nil
        )
        
        #expect(targetState.target == "my-app")
        #expect(targetState.isActive == true)
        #expect(targetState.lastHeartbeat == now)
        #expect(targetState.lastBuild == buildInfo)
        #expect(!targetState.isStale)
    }
    
    @Test("Target staleness detection")
    func testTargetStaleness() {
        // Fresh heartbeat (1 minute ago)
        let freshHeartbeat = Date().addingTimeInterval(-60)
        let freshTarget = TargetState(
            target: "fresh",
            isActive: true,
            lastHeartbeat: freshHeartbeat,
            lastBuild: nil,
            icon: nil
        )
        
        // Stale heartbeat (10 minutes ago)
        let staleHeartbeat = Date().addingTimeInterval(-600)
        let staleTarget = TargetState(
            target: "stale",
            isActive: true,
            lastHeartbeat: staleHeartbeat,
            lastBuild: nil,
            icon: nil
        )
        
        // No heartbeat
        let noHeartbeatTarget = TargetState(
            target: "none",
            isActive: true,
            lastHeartbeat: nil,
            lastBuild: nil,
            icon: nil
        )
        
        #expect(!freshTarget.isStale)
        #expect(staleTarget.isStale)
        #expect(noHeartbeatTarget.isStale)
    }
}

// MARK: - Build Info Tests
@Suite("Build Info Tests", .tags(.models, .fast))
struct BuildInfoTests {
    
    @Test("Build info initialization")
    func testBuildInfoInitialization() {
        let timestamp = Date()
        let startTime = timestamp.addingTimeInterval(-5)
        
        let buildInfo = BuildInfo(
            status: "success",
            timestamp: timestamp,
            errorSummary: "No errors",
            buildTime: 4.2,
            gitHash: "deadbeef",
            startTime: startTime
        )
        
        #expect(buildInfo.status == "success")
        #expect(buildInfo.timestamp == timestamp)
        #expect(buildInfo.errorSummary == "No errors")
        #expect(buildInfo.buildTime == 4.2)
        #expect(buildInfo.gitHash == "deadbeef")
        #expect(buildInfo.startTime == startTime)
        #expect(!buildInfo.isBuilding)
    }
    
    @Test("Build status detection", arguments: [
        ("building", true),
        ("success", false),
        ("failed", false),
        ("queued", false)
    ])
    func testBuildStatusDetection(status: String, expectedIsBuilding: Bool) {
        let buildInfo = BuildInfo(
            status: status,
            timestamp: Date(),
            errorSummary: nil,
            buildTime: nil,
            gitHash: nil,
            startTime: nil
        )
        
        #expect(buildInfo.isBuilding == expectedIsBuilding)
    }
    
    @Test("Build progress calculation")
    func testBuildProgressCalculation() {
        let now = Date()
        
        // Non-building status should return nil
        let nonBuildingInfo = BuildInfo(
            status: "success",
            timestamp: now,
            errorSummary: nil,
            buildTime: nil,
            gitHash: nil,
            startTime: nil
        )
        #expect(nonBuildingInfo.buildProgress == nil)
        
        // Building without start time should return nil
        let buildingNoStartInfo = BuildInfo(
            status: "building",
            timestamp: now,
            errorSummary: nil,
            buildTime: nil,
            gitHash: nil,
            startTime: nil
        )
        #expect(buildingNoStartInfo.buildProgress == nil)
        
        // Building with start time should calculate progress
        let startTime = now.addingTimeInterval(-15) // 15 seconds ago
        let buildingInfo = BuildInfo(
            status: "building",
            timestamp: now,
            errorSummary: nil,
            buildTime: nil,
            gitHash: nil,
            startTime: startTime
        )
        
        let progress = try #require(buildingInfo.buildProgress)
        #expect(progress > 0.0)
        #expect(progress <= 0.95) // Should be capped at 95%
        #expect(progress == 15.0 / 30.0) // 15 seconds out of 30 second estimate
    }
}

// MARK: - Build Queue Tests
@Suite("Build Queue Tests", .tags(.models, .fast))
struct BuildQueueTests {
    
    @Test("Build queue initialization")
    func testBuildQueueInitialization() {
        let queuedBuild = QueuedBuild(
            target: "app",
            project: "MyProject",
            queuedAt: Date(),
            priority: 1,
            reason: "file-change"
        )
        
        let activeBuild = ActiveBuild(
            target: "tests",
            project: "MyProject",
            startedAt: Date(),
            estimatedDuration: 30.0,
            progress: 0.5,
            currentPhase: "compiling"
        )
        
        let completedBuild = CompletedBuild(
            target: "lib",
            project: "MyProject",
            startedAt: Date().addingTimeInterval(-60),
            completedAt: Date(),
            status: "success",
            duration: 45.0,
            errorSummary: nil,
            gitHash: "abc123"
        )
        
        let buildQueue = BuildQueueInfo(
            queuedBuilds: [queuedBuild],
            activeBuilds: [activeBuild],
            recentBuilds: [completedBuild]
        )
        
        #expect(buildQueue.queuedBuilds.count == 1)
        #expect(buildQueue.activeBuilds.count == 1)
        #expect(buildQueue.recentBuilds.count == 1)
        #expect(buildQueue.totalQueueLength == 2) // queued + active
        #expect(buildQueue.hasActivity == true)
    }
    
    @Test("Build queue activity detection")
    func testBuildQueueActivity() {
        // Empty queue
        let emptyQueue = BuildQueueInfo(
            queuedBuilds: [],
            activeBuilds: [],
            recentBuilds: []
        )
        #expect(!emptyQueue.hasActivity)
        #expect(emptyQueue.totalQueueLength == 0)
        
        // Queue with only completed builds
        let completedOnlyQueue = BuildQueueInfo(
            queuedBuilds: [],
            activeBuilds: [],
            recentBuilds: [CompletedBuild(
                target: "test",
                project: "test",
                startedAt: Date(),
                completedAt: Date(),
                status: "success",
                duration: 1.0,
                errorSummary: nil,
                gitHash: nil
            )]
        )
        #expect(!completedOnlyQueue.hasActivity)
        #expect(completedOnlyQueue.totalQueueLength == 0)
    }
}

// MARK: - Completed Build Tests
@Suite("Completed Build Tests", .tags(.models, .fast))
struct CompletedBuildTests {
    
    @Test("Completed build success detection", arguments: [
        ("success", true),
        ("failed", false),
        ("cancelled", false),
        ("timeout", false)
    ])
    func testCompletedBuildSuccess(status: String, expectedSuccess: Bool) {
        let build = CompletedBuild(
            target: "test",
            project: "test", 
            startedAt: Date(),
            completedAt: Date(),
            status: status,
            duration: 1.0,
            errorSummary: nil,
            gitHash: nil
        )
        
        #expect(build.wasSuccessful == expectedSuccess)
    }
    
    @Test("Time since completion calculation")
    func testTimeSinceCompletion() {
        let completedAt = Date().addingTimeInterval(-120) // 2 minutes ago
        
        let build = CompletedBuild(
            target: "test",
            project: "test",
            startedAt: Date(),
            completedAt: completedAt,
            status: "success",
            duration: 1.0,
            errorSummary: nil,
            gitHash: nil
        )
        
        let timeSince = build.timeSinceCompletion
        #expect(timeSince >= 120.0) // At least 2 minutes
        #expect(timeSince < 125.0)  // But not too much more (accounting for test execution time)
    }
}

// MARK: - Poltergeist State Model Tests
@Suite("Poltergeist State Model Tests", .tags(.models, .unit))
struct PoltergeistStateTests {
    
    @Test("Poltergeist state JSON decoding")
    func testPoltergeistStateDecoding() throws {
        let jsonData = """
        {
            "version": "1.0.0",
            "projectPath": "/Users/test/MyProject",
            "projectName": "MyProject",
            "target": "app",
            "configPath": "/Users/test/MyProject/poltergeist.config.json",
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
                "bundleId": "com.example.myapp",
                "outputPath": "/Users/test/MyProject/.build/debug/MyApp",
                "iconPath": "/Users/test/MyProject/Assets/icon.png"
            }
        }
        """.data(using: .utf8)!
        
        let state = try JSONDecoder().decode(PoltergeistState.self, from: jsonData)
        
        #expect(state.version == "1.0.0")
        #expect(state.projectPath == "/Users/test/MyProject")
        #expect(state.projectName == "MyProject")
        #expect(state.target == "app")
        #expect(state.process.pid == 12345)
        #expect(state.process.isActive == true)
        
        let build = try #require(state.lastBuild)
        #expect(build.status == "success")
        #expect(build.buildTime == 30.5)
        #expect(build.gitHash == "abc123def456")
        
        #expect(state.appInfo.bundleId == "com.example.myapp")
        #expect(state.appInfo.outputPath == "/Users/test/MyProject/.build/debug/MyApp")
        #expect(state.appInfo.iconPath == "/Users/test/MyProject/Assets/icon.png")
    }
    
    @Test("Poltergeist state with minimal data")
    func testPoltergeistStateMinimalDecoding() throws {
        let jsonData = """
        {
            "version": "1.0.0",
            "projectPath": "/test",
            "projectName": "Test",
            "target": "main",
            "configPath": "/test/config.json",
            "process": {
                "pid": 100,
                "isActive": false,
                "startTime": "2025-01-01T00:00:00Z",
                "lastHeartbeat": "2025-01-01T00:01:00Z"
            },
            "lastBuild": null,
            "appInfo": {
                "bundleId": null,
                "outputPath": null,
                "iconPath": null
            }
        }
        """.data(using: .utf8)!
        
        let state = try JSONDecoder().decode(PoltergeistState.self, from: jsonData)
        
        #expect(state.version == "1.0.0")
        #expect(state.projectName == "Test")
        #expect(state.process.pid == 100)
        #expect(state.process.isActive == false)
        #expect(state.lastBuild == nil)
        #expect(state.appInfo.bundleId == nil)
    }
}