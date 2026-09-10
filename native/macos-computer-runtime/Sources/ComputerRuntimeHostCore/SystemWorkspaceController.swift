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
        let application = try await openApplicationUsingWorkspace(at: url)
        return try workspaceApplication(from: application)
    }

    func activate(_ application: WorkspaceApplication) async -> Bool {
        guard let running = NSRunningApplication(processIdentifier: application.processIdentifier),
              !running.isTerminated
        else {
            return false
        }
        if running.isActive { return true }
        guard let bundleURL = running.bundleURL else { return false }

        do {
            let activated = try await openApplicationUsingWorkspace(at: bundleURL)
            return activated.processIdentifier == running.processIdentifier
        } catch {
            return false
        }
    }

    @MainActor
    private func openApplicationUsingWorkspace(at url: URL) async throws -> NSRunningApplication {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false

        return try await withCheckedThrowingContinuation { continuation in
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
