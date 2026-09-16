import Foundation
import XCTest
@testable import ComputerRuntimeFixtureOracle

final class FixtureOracleTests: XCTestCase {
    func testWritesOnlyTheSevenContentSafeSnapshotFields() throws {
        let fileURL = temporaryOracleURL()
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }

        let store = try FixtureOracleStore(fileURL: fileURL)
        try store.markReady()
        try store.recordTextEdit("native-benchmark")
        try store.recordCheckboxChange(isChecked: true)
        try store.recordButtonPress()

        let data = try Data(contentsOf: fileURL)
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(Set(object.keys), Set([
            "version",
            "ready",
            "textMatchesExpectedToken",
            "checkboxChecked",
            "buttonPressCount",
            "textEditCount",
            "checkboxToggleCount",
        ]))
        XCTAssertEqual(object["version"] as? Int, 1)
        XCTAssertEqual(object["ready"] as? Bool, true)
        XCTAssertEqual(object["textMatchesExpectedToken"] as? Bool, true)
        XCTAssertEqual(object["checkboxChecked"] as? Bool, true)
        XCTAssertEqual(object["buttonPressCount"] as? Int, 1)
        XCTAssertEqual(object["textEditCount"] as? Int, 1)
        XCTAssertEqual(object["checkboxToggleCount"] as? Int, 1)

        let attributes = try FileManager.default.attributesOfItem(atPath: fileURL.path)
        let permissions = try XCTUnwrap(attributes[.posixPermissions] as? NSNumber)
        XCTAssertEqual(permissions.intValue & 0o777, 0o600)
    }

    func testTextEditsStoreOnlyFixedTokenEqualityAndCounter() throws {
        let fileURL = temporaryOracleURL()
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }

        let store = try FixtureOracleStore(fileURL: fileURL)
        let rawInput = "private-user-content-that-must-not-persist"
        try store.recordTextEdit(rawInput)

        var data = try Data(contentsOf: fileURL)
        var snapshot = try JSONDecoder().decode(FixtureOracleSnapshot.self, from: data)
        XCTAssertFalse(snapshot.textMatchesExpectedToken)
        XCTAssertEqual(snapshot.textEditCount, 1)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains(rawInput))

        try store.recordTextEdit("native-benchmark")
        data = try Data(contentsOf: fileURL)
        snapshot = try JSONDecoder().decode(FixtureOracleSnapshot.self, from: data)
        XCTAssertTrue(snapshot.textMatchesExpectedToken)
        XCTAssertEqual(snapshot.textEditCount, 2)
        XCTAssertFalse(String(decoding: data, as: UTF8.self).contains("native-benchmark"))
    }

    func testCheckboxAndButtonTransitionsStoreOnlyBooleansAndCounters() throws {
        let fileURL = temporaryOracleURL()
        defer { try? FileManager.default.removeItem(at: fileURL.deletingLastPathComponent()) }

        let store = try FixtureOracleStore(fileURL: fileURL)
        try store.recordCheckboxChange(isChecked: true)
        try store.recordCheckboxChange(isChecked: false)
        try store.recordButtonPress()
        try store.recordButtonPress()

        let snapshot = try JSONDecoder().decode(FixtureOracleSnapshot.self, from: Data(contentsOf: fileURL))
        XCTAssertFalse(snapshot.checkboxChecked)
        XCTAssertEqual(snapshot.checkboxToggleCount, 2)
        XCTAssertEqual(snapshot.buttonPressCount, 2)
        XCTAssertFalse(snapshot.ready)
    }

    func testNilOraclePathIsAContentFreeNoOp() throws {
        let store = try FixtureOracleStore(fileURL: nil)
        XCTAssertNoThrow(try store.markReady())
        XCTAssertNoThrow(try store.recordTextEdit("must-not-be-persisted"))
        XCTAssertNoThrow(try store.recordCheckboxChange(isChecked: true))
        XCTAssertNoThrow(try store.recordButtonPress())
    }

    private func temporaryOracleURL() -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("computer-runtime-fixture-oracle-\(UUID().uuidString)", isDirectory: true)
        try! FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true,
            attributes: [.posixPermissions: 0o700]
        )
        return directory.appendingPathComponent("oracle.json")
    }
}
