//
//  FileWatcher.swift
//  Poltergeist
//
//  Created by Poltergeist on 2025.
//

import Foundation
import os.log

class FileWatcher {
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "FileWatcher")
    private let path: String
    private let callback: () -> Void
    private var stream: FSEventStreamRef?
    private let queue = DispatchQueue(label: "com.poltergeist.filewatcher", qos: .background)

    init(path: String, callback: @escaping () -> Void) {
        self.path = path
        self.callback = callback
    }

    func start() {
        // Create a context that holds a reference to self
        let selfPtr = Unmanaged.passUnretained(self).toOpaque()

        var context = FSEventStreamContext(
            version: 0,
            info: selfPtr,
            retain: nil,
            release: nil,
            copyDescription: nil
        )

        let callback: FSEventStreamCallback = { _, clientCallBackInfo, numEvents, _, _, _ in
            guard let info = clientCallBackInfo else { return }
            let watcher = Unmanaged<FileWatcher>.fromOpaque(info).takeUnretainedValue()

            if numEvents > 0 {
                DispatchQueue.main.async {
                    watcher.callback()
                }
            }
        }

        let pathsToWatch = [path] as CFArray

        stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            pathsToWatch,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.5,  // Latency in seconds
            FSEventStreamCreateFlags(
                kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
        )

        if let stream = stream {
            FSEventStreamSetDispatchQueue(stream, queue)
            FSEventStreamStart(stream)
            logger.debug("Started watching: \(self.path)")
        }
    }

    func stop() {
        if let stream = stream {
            FSEventStreamStop(stream)
            FSEventStreamInvalidate(stream)
            FSEventStreamRelease(stream)
            self.stream = nil
            logger.debug("Stopped watching: \(self.path)")
        }
    }

    deinit {
        stop()
    }
}
