//
//  FileWatcher.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import Foundation
import os.log

/// Modern directory watcher using DispatchSource instead of FSEventStreamRef
/// This provides simplified memory management and proper queue isolation
/// Uses manual synchronization via DispatchQueue.main.async for thread safety
final class FileWatcher: @unchecked Sendable {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "FileWatcher")
    private let path: String
    private let callback: @Sendable () -> Void
    private let eventQueue = DispatchQueue(
        label: "com.poltergeist.monitor.filewatcher",
        qos: .utility
    )

    private var directoryFileDescriptor: CInt = -1
    private var directorySource: DispatchSourceFileSystemObject?
    private let lock = NSLock()

    /// - Parameter callback: Called on main queue when file system changes are detected
    init(path: String, callback: @escaping @Sendable () -> Void) {
        self.path = path
        self.callback = callback
    }

    func start() {
        lock.lock()
        defer { lock.unlock() }

        // Don't start if already running
        guard directorySource == nil else { return }

        // Open the directory to get a file descriptor
        directoryFileDescriptor = open(path, O_EVTONLY)
        guard directoryFileDescriptor >= 0 else {
            logger.error("Failed to open directory: \(self.path)")
            return
        }

        // Create dispatch source to monitor the directory
        // Only monitor writes and deletes to reduce noise from metadata changes
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: directoryFileDescriptor,
            eventMask: [.write, .delete],
            queue: eventQueue
        )

        source.setEventHandler { [weak self] in
            guard let callback = self?.callback else { return }
            // Forward to the main queue explicitly to satisfy @MainActor callers
            DispatchQueue.main.async {
                callback()
            }
        }

        source.setCancelHandler { [weak self] in
            guard let self = self else { return }
            if self.directoryFileDescriptor >= 0 {
                close(self.directoryFileDescriptor)
                self.directoryFileDescriptor = -1
            }
        }

        directorySource = source
        source.resume()

        logger.debug("Started watching: \(self.path)")
    }

    func stop() {
        lock.lock()
        defer { lock.unlock() }

        if let source = directorySource {
            source.cancel()
            directorySource = nil
            logger.debug("Stopped watching: \(self.path)")
        }
    }

    deinit {
        // Safe cleanup from deinit
        if let source = directorySource {
            source.cancel()
        }
        if directoryFileDescriptor >= 0 {
            close(directoryFileDescriptor)
        }
    }
}
