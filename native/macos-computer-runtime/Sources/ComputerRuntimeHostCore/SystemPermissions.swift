import ApplicationServices
import CoreGraphics

public struct SystemPermissionReader: PermissionReading {
    public init() {}

    public func accessibilityTrusted() -> Bool {
        let options = [
            "AXTrustedCheckOptionPrompt": false,
        ] as CFDictionary
        return AXIsProcessTrustedWithOptions(options)
    }

    public func screenCaptureAuthorized() -> Bool {
        CGPreflightScreenCaptureAccess()
    }

    public func eventListenAuthorized() -> Bool {
        CGPreflightListenEventAccess()
    }

    public func eventPostAuthorized() -> Bool {
        CGPreflightPostEventAccess()
    }
}
