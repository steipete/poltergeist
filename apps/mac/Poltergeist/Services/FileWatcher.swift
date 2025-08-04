//
//  FileWatcher.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import Foundation
import os.log

/// Protocol to avoid Swift concurrency isolation checks
protocol FileWatcherDelegate: AnyObject {
    func fileWatcherDidDetectChange()
}

/// Modern directory watcher using DispatchSource instead of FSEventStreamRef
/// This provides simplified memory management and proper queue isolation
/// Uses delegate pattern to avoid Swift concurrency issues
final class FileWatcher {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "FileWatcher")
    private let path: String
    weak var delegate: FileWatcherDelegate?
    private let queue = DispatchQueue(label: "com.poltergeist.filewatcher", qos: .background)

    private var directoryFileDescriptor: CInt = -1
    private var directorySource: DispatchSourceFileSystemObject?
    private let lock = NSLock()

    init(path: String, delegate: FileWatcherDelegate) {
        self.path = path
        self.delegate = delegate
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
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: directoryFileDescriptor,
            eventMask: [.write, .delete, .extend, .attrib, .link, .rename, .revoke],
            queue: queue
        )

        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            // Dispatch to main queue to call delegate method safely
            DispatchQueue.main.async {
                self.delegate?.fileWatcherDidDetectChange()
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
