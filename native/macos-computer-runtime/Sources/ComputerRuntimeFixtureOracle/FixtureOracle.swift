import Darwin
import Foundation

struct FixtureOracleSnapshot: Codable, Equatable {
    let version: Int
    var ready: Bool
    var textMatchesExpectedToken: Bool
    var checkboxChecked: Bool
    var buttonPressCount: Int
    var textEditCount: Int
    var checkboxToggleCount: Int
}

public final class FixtureOracleStore {
    private let fileURL: URL?
    private var snapshot = FixtureOracleSnapshot(
        version: 1,
        ready: false,
        textMatchesExpectedToken: false,
        checkboxChecked: false,
        buttonPressCount: 0,
        textEditCount: 0,
        checkboxToggleCount: 0
    )

    public init(fileURL: URL?) throws {
        self.fileURL = fileURL
        try persist()
    }

    public func markReady() throws {
        snapshot.ready = true
        try persist()
    }

    public func recordTextEdit(_ value: String) throws {
        snapshot.textMatchesExpectedToken = value == "native-benchmark"
        snapshot.textEditCount += 1
        try persist()
    }

    public func recordCheckboxChange(isChecked: Bool) throws {
        snapshot.checkboxChecked = isChecked
        snapshot.checkboxToggleCount += 1
        try persist()
    }

    public func recordButtonPress() throws {
        snapshot.buttonPressCount += 1
        try persist()
    }

    private func persist() throws {
        guard let fileURL else { return }
        let data = try JSONEncoder().encode(snapshot)
        let temporaryURL = fileURL.deletingLastPathComponent()
            .appendingPathComponent(".\(fileURL.lastPathComponent).tmp-\(UUID().uuidString)")
        let created = FileManager.default.createFile(
            atPath: temporaryURL.path,
            contents: data,
            attributes: [.posixPermissions: 0o600]
        )
        guard created else {
            throw CocoaError(.fileWriteUnknown)
        }
        defer { try? FileManager.default.removeItem(at: temporaryURL) }

        let renameResult: Int32 = temporaryURL.withUnsafeFileSystemRepresentation { source in
            fileURL.withUnsafeFileSystemRepresentation { destination in
                guard let source, let destination else { return -1 }
                return Darwin.rename(source, destination)
            }
        }
        guard renameResult == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
        let chmodResult: Int32 = fileURL.withUnsafeFileSystemRepresentation { path in
            guard let path else { return -1 }
            return Darwin.chmod(path, S_IRUSR | S_IWUSR)
        }
        guard chmodResult == 0 else {
            throw CocoaError(.fileWriteUnknown)
        }
    }
}
