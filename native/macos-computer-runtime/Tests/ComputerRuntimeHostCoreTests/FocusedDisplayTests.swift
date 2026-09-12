import ComputerRuntimeCore
import CoreGraphics
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

final class FocusedDisplayTests: XCTestCase {
    func testSelectsTheFocusedDisplayRatherThanTheFirstAvailableOne() throws {
        let selected = try FocusedDisplaySelection.select(
            availableDisplayIDs: [1, 7, 9],
            focusedDisplayID: 7
        )

        XCTAssertEqual(selected, 7)
    }

    func testFailsClosedWhenTheFocusedDisplayIsUnknown() {
        XCTAssertThrowsError(
            try FocusedDisplaySelection.select(availableDisplayIDs: [1, 9], focusedDisplayID: nil)
        ) { error in
            XCTAssertEqual(error as? ScreenshotCaptureError, .unavailable)
        }
    }

    func testFailsClosedWhenTheFocusedDisplayIsNoLongerShareable() {
        XCTAssertThrowsError(
            try FocusedDisplaySelection.select(availableDisplayIDs: [1, 9], focusedDisplayID: 7)
        ) { error in
            XCTAssertEqual(error as? ScreenshotCaptureError, .unavailable)
        }
    }
}
