import Foundation
import AppKit
import os.log

class IconLoader {
    static let shared = IconLoader()
    private let logger = Logger(subsystem: "com.poltergeist.monitor", category: "IconLoader")
    private var iconCache: [String: NSImage] = [:]
    
    private init() {}
    
    func loadIcon(from state: PoltergeistState, projectPath: String) -> NSImage? {
        let cacheKey = "\(projectPath)-\(state.target)"
        
        // Check cache first
        if let cachedIcon = iconCache[cacheKey] {
            return cachedIcon
        }
        
        // 1. First try the configured icon path
        if let iconPath = state.appInfo.iconPath {
            let fullPath = URL(fileURLWithPath: projectPath)
                .appendingPathComponent(iconPath)
            
            if let image = NSImage(contentsOf: fullPath) {
                logger.debug("Loaded icon from configured path: \(iconPath)")
                iconCache[cacheKey] = image
                return image
            }
        }
        
        // 2. For Mac apps, try extracting from built app
        if state.target == "macApp", 
           let outputPath = state.appInfo.outputPath,
           let bundle = Bundle(path: outputPath) {
            if let iconFile = bundle.object(forInfoDictionaryKey: "CFBundleIconFile") as? String {
                let iconName = iconFile.replacingOccurrences(of: ".icns", with: "")
                if let iconURL = bundle.url(forResource: iconName, withExtension: "icns"),
                   let image = NSImage(contentsOf: iconURL) {
                    logger.debug("Loaded icon from app bundle: \(outputPath)")
                    iconCache[cacheKey] = image
                    return image
                }
            }
        }
        
        // 3. Fall back to generic icon based on target type
        let fallbackIcon = getFallbackIcon(for: state.target)
        iconCache[cacheKey] = fallbackIcon
        return fallbackIcon
    }
    
    private func getFallbackIcon(for target: String) -> NSImage? {
        let symbolName: String
        switch target {
        case "cli":
            symbolName = "terminal.fill"
        case "macApp":
            symbolName = "macwindow"
        case "iosApp":
            symbolName = "iphone"
        case "watchApp":
            symbolName = "applewatch"
        case "tvApp":
            symbolName = "appletv"
        default:
            symbolName = "app.fill"
        }
        
        return NSImage(systemSymbolName: symbolName, accessibilityDescription: target)
    }
    
    func clearCache() {
        iconCache.removeAll()
    }
    
    func removeFromCache(projectPath: String, target: String) {
        let cacheKey = "\(projectPath)-\(target)"
        iconCache.removeValue(forKey: cacheKey)
    }
}