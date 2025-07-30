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
        let callback: FSEventStreamCallback = { _, _, numEvents, _, _, _ in
            if numEvents > 0 {
                DispatchQueue.main.async { [weak self] in
                    self?.callback()
                }
            }
        }
        
        var context = FSEventStreamContext(
            version: 0,
            info: nil,
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        
        let pathsToWatch = [path] as CFArray
        
        stream = FSEventStreamCreate(
            kCFAllocatorDefault,
            callback,
            &context,
            pathsToWatch,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.5, // Latency in seconds
            FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagFileEvents)
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