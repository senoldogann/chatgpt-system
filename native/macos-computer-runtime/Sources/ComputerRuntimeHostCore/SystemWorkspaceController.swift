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

    func applicationURL(name: String) -> URL? {
        let cleanName = name.hasSuffix(".app") ? String(name.dropLast(4)) : name
        let fileManager = FileManager.default
        let searchDirectories: [URL] = [
            URL(fileURLWithPath: "/Applications", isDirectory: true),
            URL(fileURLWithPath: "/System/Applications", isDirectory: true),
            URL(fileURLWithPath: "/System/Applications/Utilities", isDirectory: true),
            fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Applications", isDirectory: true)
        ]

        for directory in searchDirectories {
            let candidate = directory.appendingPathComponent("\(cleanName).app")
            if fileManager.fileExists(atPath: candidate.path) {
                return candidate
            }
        }

        for directory in searchDirectories {
            guard let contents = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
                continue
            }
            for appURL in contents where appURL.pathExtension == "app" {
                let baseName = appURL.deletingPathExtension().lastPathComponent
                if baseName.localizedCaseInsensitiveCompare(cleanName) == .orderedSame {
                    return appURL
                }
            }
        }
        return nil
    }

    func openApplication(at url: URL) async throws -> WorkspaceApplication {
        try await openApplication(at: url, arguments: [])
    }

    func openApplication(at url: URL, arguments: [String]) async throws -> WorkspaceApplication {
        let application = try await openApplicationUsingWorkspace(at: url, arguments: arguments)
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
            let activated = try await openApplicationUsingWorkspace(at: bundleURL, arguments: [])
            return activated.processIdentifier == running.processIdentifier
        } catch {
            return false
        }
    }

    @MainActor
    static func makeOpenConfiguration(arguments: [String]) -> NSWorkspace.OpenConfiguration {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        configuration.createsNewApplicationInstance = false
        configuration.addsToRecentItems = false
        configuration.promptsUserIfNeeded = false
        configuration.arguments = arguments
        return configuration
    }

    @MainActor
    private func openApplicationUsingWorkspace(
        at url: URL,
        arguments: [String]
    ) async throws -> NSRunningApplication {
        let configuration = Self.makeOpenConfiguration(arguments: arguments)

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
