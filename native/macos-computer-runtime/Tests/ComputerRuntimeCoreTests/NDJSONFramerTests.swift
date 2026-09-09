import XCTest
@testable import ComputerRuntimeCore

final class NDJSONFramerTests: XCTestCase {
    func testReturnsCompleteLinesAcrossChunks() throws {
        var framer = NDJSONFramer(maxLineBytes: 32)
        XCTAssertEqual(try framer.append(Data("{\"a\":1".utf8)), [])
        let frames = try framer.append(Data("}\n{\"b\":2}\n".utf8))
        XCTAssertEqual(frames.map { String(decoding: $0, as: UTF8.self) }, ["{\"a\":1}", "{\"b\":2}"])
    }

    func testRejectsOversizedLineBeforeNewline() throws {
        var framer = NDJSONFramer(maxLineBytes: 4)
        XCTAssertThrowsError(try framer.append(Data("12345".utf8))) { error in
            XCTAssertEqual(error as? NDJSONFramingError, .lineTooLarge)
        }
    }

    func testRejectsEmptyLineAndTrailingPartialFrame() throws {
        var empty = NDJSONFramer(maxLineBytes: 32)
        XCTAssertThrowsError(try empty.append(Data("\n".utf8)))

        var partial = NDJSONFramer(maxLineBytes: 32)
        _ = try partial.append(Data("{\"a\":1}".utf8))
        XCTAssertThrowsError(try partial.finish())
    }
}
