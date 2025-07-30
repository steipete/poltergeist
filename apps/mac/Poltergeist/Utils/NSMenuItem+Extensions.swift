import AppKit

extension NSMenuItem {
    /// Convenience method for configuring menu items inline
    func with(_ configure: (NSMenuItem) -> Void) -> NSMenuItem {
        configure(self)
        return self
    }
}