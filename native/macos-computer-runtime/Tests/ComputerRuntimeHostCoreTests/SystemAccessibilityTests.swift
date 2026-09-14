import ApplicationServices
import XCTest
@testable import ComputerRuntimeHostCore

final class SystemAccessibilityTests: XCTestCase {
    func testGenericAXFailureIsRecoverableMissingAttribute() {
        XCTAssertTrue(isRecoverableAccessibilityAttributeError(.failure))
        XCTAssertTrue(isRecoverableAccessibilityAttributeError(.attributeUnsupported))
        XCTAssertTrue(isRecoverableAccessibilityAttributeError(.noValue))

        XCTAssertFalse(isRecoverableAccessibilityAttributeError(.apiDisabled))
        XCTAssertFalse(isRecoverableAccessibilityAttributeError(.cannotComplete))
        XCTAssertFalse(isRecoverableAccessibilityAttributeError(.invalidUIElement))
    }

    func testInteractionMetadataBoundsActionsAndDetectsScrollAxes() {
        let metadata = SystemAccessibilityReader.interactionMetadata(
            role: "AXScrollArea",
            actionNames: [
                "AXScrollDownByPage",
                "AXScrollRightByPage",
            ] + (0..<20).map { "custom-action-\($0)-" + String(repeating: "x", count: 200) }
        )

        XCTAssertTrue(metadata.scroll.scrollable)
        XCTAssertEqual(metadata.scroll.axes, [.vertical, .horizontal])
        XCTAssertEqual(metadata.actions.count, 16)
        XCTAssertTrue(metadata.actions.allSatisfy { $0.count <= 128 })
    }
}
