@preconcurrency import AppKit
import Foundation

struct SystemWorkspaceController: ApplicationControlling {
    func runningApplications() -> [WorkspaceApplication] {
        SystemWorkspaceReader().runningApplications()
    }

    func frontmostApplication() -> WorkspaceApplication? {
        SystemWorkspaceReader().frontmostApplication()
    }

    func applicationURL(bundleIdentifier: String) -> URL? {
        NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleIdentifier)
    }

    func openApplication(at url: URL) async throws -> WorkspaceApplication {
        let application: NSRunningApplication = try await withCheckedThrowingContinuation { continuation in
            let configuration = NSWorkspace.OpenConfiguration()
            NSWorkspace.shared.openApplication(at: url, configuration: configuration) { application, error in
                if let application {
                    continuation.resume(returning: application)
                } else if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume(throwing: ComputerInputError.unavailable)
                }
            }
        }
        return try workspaceApplication(from: application)
    }

    func activate(_ application: WorkspaceApplication) -> Bool {
        guard let running = NSRunningApplication(processIdentifier: application.processIdentifier),
              !running.isTerminated
        else {
            return false
        }
        return running.activate(options: [.activateAllWindows])
    }

    private func workspaceApplication(from application: NSRunningApplication) throws -> WorkspaceApplication {
        guard !application.isTerminated,
              let name = application.localizedName,
              !name.isEmpty
        else {
            throw ComputerInputError.unavailable
        }
        let frontmostPID = NSWorkspace.shared.frontmostApplication?.processIdentifier
        return WorkspaceApplication(
            processIdentifier: application.processIdentifier,
            name: name,
            bundleIdentifier: application.bundleIdentifier,
            frontmost: application.processIdentifier == frontmostPID
        )
    }
}
