@preconcurrency import AppKit
import Foundation

func boundedText(_ value: String?, max: Int = 4_096) -> String? {
    guard let value else { return nil }
    return String(value.prefix(max))
}

public struct SystemWorkspaceReader: WorkspaceReading {
    public init() {}

    public func runningApplications() -> [WorkspaceApplication] {
        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier

        return NSWorkspace.shared.runningApplications
            .compactMap { application -> WorkspaceApplication? in
                guard !application.isTerminated,
                      let rawName = application.localizedName,
                      !rawName.isEmpty
                else {
                    return nil
                }

                return WorkspaceApplication(
                    processIdentifier: application.processIdentifier,
                    name: rawName,
                    bundleIdentifier: application.bundleIdentifier,
                    frontmost: application.processIdentifier == frontmostPID
                )
            }
            .sorted { lhs, rhs in
                if lhs.name != rhs.name {
                    return lhs.name < rhs.name
                }
                return (lhs.bundleIdentifier ?? "") < (rhs.bundleIdentifier ?? "")
            }
    }

    public func frontmostApplication() -> WorkspaceApplication? {
        guard let application = NSWorkspace.shared.frontmostApplication,
              !application.isTerminated,
              let name = application.localizedName,
              !name.isEmpty
        else {
            return nil
        }

        return WorkspaceApplication(
            processIdentifier: application.processIdentifier,
            name: name,
            bundleIdentifier: application.bundleIdentifier,
            frontmost: true
        )
    }
}
