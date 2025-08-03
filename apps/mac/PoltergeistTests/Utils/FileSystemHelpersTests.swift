//
//  FileSystemHelpersTests.swift
//  PoltergeistTests
//
//  Created by Poltergeist on 2025.
//

import Testing
import Foundation
@testable import Poltergeist

// MARK: - Test Tags
extension Tag {
    @Tag static var utils: Self
    @Tag static var fileSystem: Self
}

// MARK: - File System Helper Tests
@Suite("File System Helper Tests", .tags(.utils, .fileSystem))
@MainActor
final class FileSystemHelpersTests {
    
    let tempDirectory: URL
    
    init() throws {
        // Create a temporary directory for testing
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("poltergeist-fs-tests")
            .appendingPathComponent(UUID().uuidString)
        
        try FileManager.default.createDirectory(
            at: tempDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
    }
    
    deinit {
        // Clean up temporary directory
        try? FileManager.default.removeItem(at: tempDirectory)
    }
    
    // MARK: - File Extension Tests
    
    @Test("File extension detection", arguments: [
        ("test.state", ".state"),
        ("project.json", ".json"),
        ("app.swift", ".swift"),
        ("README.md", ".md"),
        ("Makefile", ""),
        ("file.", "."),
        ("", ""),
        (".hidden", ""),
        (".config.json", ".json")
    ])
    func testFileExtensionDetection(filename: String, expectedExtension: String) {
        let url = URL(fileURLWithPath: filename)
        let pathExtension = url.pathExtension
        
        #expect(pathExtension == expectedExtension.dropFirst()) // URL.pathExtension doesn't include the dot
    }
    
    @Test("State file identification", arguments: [
        ("project-abc12345-target.state", true),
        ("other-def67890-app.state", true),
        ("config.json", false),
        ("README.md", false),
        ("project.state.backup", false),
        ("state.txt", false)
    ])
    func testStateFileIdentification(filename: String, expectedIsStateFile: Bool) {
        let isStateFile = filename.hasSuffix(".state")
        #expect(isStateFile == expectedIsStateFile)
    }
    
    // MARK: - Path Manipulation Tests
    
    @Test("Path joining and normalization")
    func testPathJoiningAndNormalization() throws {
        let basePath = tempDirectory.path
        let relativePath = "subdir/file.txt"
        
        let fullPath = URL(fileURLWithPath: basePath)
            .appendingPathComponent("subdir")
            .appendingPathComponent("file.txt")
            .path
        
        #expect(fullPath.contains(basePath))
        #expect(fullPath.contains("subdir"))
        #expect(fullPath.contains("file.txt"))
        
        // Test with existing file
        let testFile = tempDirectory.appendingPathComponent("test.txt")
        try "test content".write(to: testFile, atomically: true, encoding: .utf8)
        
        #expect(FileManager.default.fileExists(atPath: testFile.path))
        
        let content = try String(contentsOf: testFile)
        #expect(content == "test content")
    }
    
    @Test("Directory creation and cleanup")
    func testDirectoryCreationAndCleanup() throws {
        let testDir = tempDirectory.appendingPathComponent("test-subdir")
        
        // Directory shouldn't exist initially
        #expect(!FileManager.default.fileExists(atPath: testDir.path))
        
        // Create directory  
        try FileManager.default.createDirectory(
            at: testDir,
            withIntermediateDirectories: true,
            attributes: nil
        )
        
        #expect(FileManager.default.fileExists(atPath: testDir.path))
        
        // Test that it's actually a directory
        var isDirectory: ObjCBool = false
        let exists = FileManager.default.fileExists(atPath: testDir.path, isDirectory: &isDirectory)
        #expect(exists)
        #expect(isDirectory.boolValue)
        
        // Clean up
        try FileManager.default.removeItem(at: testDir)
        #expect(!FileManager.default.fileExists(atPath: testDir.path))
    }
    
    // MARK: - File Content Tests
    
    @Test("File reading and writing", arguments: [
        "Simple text content",
        "Content with\nmultiple\nlines",
        "Content with special characters: åäö 🔨 ⚡️",
        "",
        "{\n  \"json\": \"content\",\n  \"number\": 42\n}"
    ])
    func testFileReadingAndWriting(content: String) throws {
        let testFile = tempDirectory.appendingPathComponent("test-\(UUID().uuidString).txt")
        
        // Write content
        try content.write(to: testFile, atomically: true, encoding: .utf8)
        #expect(FileManager.default.fileExists(atPath: testFile.path))
        
        // Read content back
        let readContent = try String(contentsOf: testFile, encoding: .utf8)
        #expect(readContent == content)
        
        // Clean up
        try FileManager.default.removeItem(at: testFile)
    }
    
    @Test("JSON file handling") 
    func testJSONFileHandling() throws {
        let testData = TestJSONData(
            name: "TestProject",
            version: "1.0.0",
            targets: ["app", "tests"],
            config: ["debug": true, "optimize": false]
        )
        
        let jsonFile = tempDirectory.appendingPathComponent("test.json")
        
        // Write JSON
        let encoder = JSONEncoder()
        encoder.outputFormatting = .prettyPrinted
        let jsonData = try encoder.encode(testData)
        try jsonData.write(to: jsonFile)
        
        #expect(FileManager.default.fileExists(atPath: jsonFile.path))
        
        // Read JSON back
        let readData = try Data(contentsOf: jsonFile)
        let decodedData = try JSONDecoder().decode(TestJSONData.self, from: readData)
        
        #expect(decodedData.name == testData.name)
        #expect(decodedData.version == testData.version)
        #expect(decodedData.targets == testData.targets)
        #expect(decodedData.config == testData.config)
    }
    
    // MARK: - File System Monitoring Tests
    
    @Test("Directory content listing")
    func testDirectoryContentListing() throws {
        // Create test files
        let testFiles = ["file1.txt", "file2.state", "file3.json", ".hidden"]
        
        for filename in testFiles {
            let filePath = tempDirectory.appendingPathComponent(filename)
            try filename.write(to: filePath, atomically: true, encoding: .utf8)
        }
        
        // List directory contents
        let contents = try FileManager.default.contentsOfDirectory(atPath: tempDirectory.path)
        
        #expect(contents.count >= testFiles.count) // Might have other files from other tests
        
        // Check that our test files exist
        for filename in testFiles {
            #expect(contents.contains(filename))
        }
        
        // Filter for state files
        let stateFiles = contents.filter { $0.hasSuffix(".state") }
        #expect(stateFiles.count == 1)
        #expect(stateFiles.contains("file2.state"))
    }
    
    @Test("File modification time tracking")
    func testFileModificationTimeTracking() async throws {
        let testFile = tempDirectory.appendingPathComponent("mod-test.txt")
        
        // Create file
        try "initial content".write(to: testFile, atomically: true, encoding: .utf8)
        
        let attributes1 = try FileManager.default.attributesOfItem(atPath: testFile.path)
        let modTime1 = attributes1[.modificationDate] as? Date
        let modTime1Required = try #require(modTime1)
        
        // Wait a bit and modify file
        try await Task.sleep(for: .milliseconds(100))
        try "modified content".write(to: testFile, atomically: true, encoding: .utf8)
        
        let attributes2 = try FileManager.default.attributesOfItem(atPath: testFile.path)
        let modTime2 = attributes2[.modificationDate] as? Date
        let modTime2Required = try #require(modTime2)
        
        #expect(modTime2Required > modTime1Required)
        
        // Verify content was actually changed
        let content = try String(contentsOf: testFile)
        #expect(content == "modified content")
    }
    
    // MARK: - Error Handling Tests
    
    @Test("File operation error handling")
    func testFileOperationErrorHandling() {
        let nonExistentFile = tempDirectory.appendingPathComponent("does-not-exist.txt")
        
        // Reading non-existent file should throw
        #expect(throws: CocoaError.self) {
            try String(contentsOf: nonExistentFile)
        }
        
        // Creating directory in non-existent parent should work with intermediates
        let deepPath = tempDirectory
            .appendingPathComponent("deep")
            .appendingPathComponent("nested")
            .appendingPathComponent("path")
        
        #expect(throws: Never.self) {
            try FileManager.default.createDirectory(
                at: deepPath,
                withIntermediateDirectories: true,
                attributes: nil
            )
        }
        
        #expect(FileManager.default.fileExists(atPath: deepPath.path))
    }
    
    @Test("Atomic file operations")
    func testAtomicFileOperations() throws {
        let testFile = tempDirectory.appendingPathComponent("atomic-test.txt")
        
        // Atomic write should either fully succeed or fail
        let largeContent = String(repeating: "Test content line\n", count: 1000)
        
        try largeContent.write(to: testFile, atomically: true, encoding: .utf8)
        
        #expect(FileManager.default.fileExists(atPath: testFile.path))
        
        let readContent = try String(contentsOf: testFile)
        #expect(readContent == largeContent)
        #expect(readContent.components(separatedBy: "\n").count == 1001) // 1000 lines + 1 empty
    }
}

// MARK: - Test Helper Models

private struct TestJSONData: Codable, Equatable {
    let name: String
    let version: String
    let targets: [String]
    let config: [String: Bool]
}

// MARK: - State File Parsing Tests
@Suite("State File Parsing Tests", .tags(.utils, .fileSystem))
@MainActor
final class StateFileParsingTests {
    
    let tempDirectory: URL
    
    init() throws {
        self.tempDirectory = FileManager.default.temporaryDirectory
            .appendingPathComponent("poltergeist-state-tests")
            .appendingPathComponent(UUID().uuidString)
        
        try FileManager.default.createDirectory(
            at: tempDirectory,
            withIntermediateDirectories: true,
            attributes: nil
        )
    }
    
    deinit {
        try? FileManager.default.removeItem(at: tempDirectory)
    }
    
    @Test("State file name parsing", arguments: [
        ("MyProject-a1b2c3d4-main.state", ("MyProject", "a1b2c3d4", "main")),
        ("Complex-Project-12345678-web-server.state", ("Complex-Project", "12345678", "web-server")),
        ("test-deadbeef-app.state", ("test", "deadbeef", "app")),
        ("multi-word-project-abcdef12-test-suite.state", ("multi-word-project", "abcdef12", "test-suite"))
    ])
    func testStateFileNameParsing(
        filename: String,
        expected: (projectName: String, hash: String, target: String)
    ) throws {
        // Extract components using regex pattern matching
        let pattern = #"^(.+)-([a-f0-9]{8})-(.+)\.state$"#
        
        guard let regex = try? NSRegularExpression(pattern: pattern, options: []),
              let match = regex.firstMatch(
                in: filename,
                options: [],
                range: NSRange(location: 0, length: filename.count)
              ) else {
            Issue.record("Failed to parse filename: \(filename)")
            return
        }
        
        let projectNameRange = Range(match.range(at: 1), in: filename)
        let hashRange = Range(match.range(at: 2), in: filename)  
        let targetRange = Range(match.range(at: 3), in: filename)
        
        let projectName = projectNameRange.map { String(filename[$0]) }
        let hash = hashRange.map { String(filename[$0]) }
        let target = targetRange.map { String(filename[$0]) }
        
        let parsedProjectName = try #require(projectName)
        let parsedHash = try #require(hash) 
        let parsedTarget = try #require(target)
        
        #expect(parsedProjectName == expected.projectName)
        #expect(parsedHash == expected.hash)
        #expect(parsedTarget == expected.target)
    }
    
    @Test("Invalid state file names")
    func testInvalidStateFileNames() {
        let invalidNames = [
            "no-hash-target.state",           // No hash
            "project-abc-target.state",       // Hash too short
            "project-abcdefgh12-target.state", // Hash too long
            "project-ABCDEFGH-target.state",  // Hash has uppercase
            "project-abcdefg!-target.state",  // Hash has special chars
            "project-12345678-.state",        // Empty target
            ".state",                         // Empty everything
            "project-12345678.state"          // Missing target separator
        ]
        
        let pattern = #"^(.+)-([a-f0-9]{8})-(.+)\.state$"#
        let regex = try? NSRegularExpression(pattern: pattern, options: [])
        
        for invalidName in invalidNames {
            let match = regex?.firstMatch(
                in: invalidName,
                options: [],
                range: NSRange(location: 0, length: invalidName.count)
            )
            
            #expect(match == nil, "Should not match invalid filename: \(invalidName)")
        }
    }
    
    @Test("State file content validation")
    func testStateFileContentValidation() throws {
        // Valid state file content
        let validContent = """
        {
            "version": "1.0.0",
            "projectPath": "/Users/test/MyProject",
            "projectName": "MyProject",
            "target": "main",
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
        
        let stateFile = tempDirectory.appendingPathComponent("MyProject-12345678-main.state")
        try validContent.write(to: stateFile, atomically: true, encoding: .utf8)
        
        // Should decode successfully
        let data = try Data(contentsOf: stateFile)
        let state = try JSONDecoder().decode(PoltergeistState.self, from: data)
        
        #expect(state.projectName == "MyProject")
        #expect(state.target == "main")
        #expect(state.process.pid == 12345)
        #expect(state.process.isActive == true)
        #expect(state.lastBuild == nil)
    }
    
    @Test("Malformed state file handling")
    func testMalformedStateFileHandling() throws {
        let malformedContents = [
            "not json at all",
            "{invalid json}",
            "{}",  // Missing required fields
            """
            {
                "version": "1.0.0",
                "projectPath": "/test",
                "projectName": "Test"
                // Missing required fields
            }
            """,
            """
            {
                "version": "1.0.0",
                "projectPath": "/test",
                "projectName": "Test",
                "target": "main",
                "configPath": "/test/config.json",
                "process": {
                    "pid": "invalid-number",
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
        ]
        
        for (index, content) in malformedContents.enumerated() {
            let stateFile = tempDirectory.appendingPathComponent("malformed-\(index).state")
            try content.write(to: stateFile, atomically: true, encoding: .utf8)
            
            let data = try Data(contentsOf: stateFile)
            
            // Should throw when trying to decode
            #expect(throws: DecodingError.self) {
                try JSONDecoder().decode(PoltergeistState.self, from: data)
            }
        }
    }
}