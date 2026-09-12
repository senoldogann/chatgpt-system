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
}
