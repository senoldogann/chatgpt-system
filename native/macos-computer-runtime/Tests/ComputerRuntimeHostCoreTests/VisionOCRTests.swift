import ComputerRuntimeCore
import CoreGraphics
import Foundation
import XCTest
@testable import ComputerRuntimeHostCore

final class VisionOCRTests: XCTestCase {
    func testOcrBoundsCandidateCountAndTextLength() async throws {
        let raw = Array(repeating: rawObservation(
            text: String(repeating: "x", count: 5_000),
            confidence: 0.9,
            bounds: ComputerBounds(x: 0.1, y: 0.2, width: 0.3, height: 0.1)
        ), count: 400)
        let ocr = SystemVisionOCR(backend: FakeVisionBackend(results: raw))

        let results = try await ocr.recognizeText(in: image(width: 200, height: 100), mode: .fast)

        XCTAssertEqual(results.count, 256)
        XCTAssertTrue(results.allSatisfy { $0.text.count == 4_096 })
        XCTAssertTrue(results.allSatisfy { $0.source == .fast })
        XCTAssertEqual(Set(results.map(\.observationId)).count, 1)
    }

    func testOcrConvertsVisionBottomLeftNormalizedBoundsToTopLeftPixels() async throws {
        let backend = FakeVisionBackend(results: [
            rawObservation(
                text: "Submit",
                confidence: 0.95,
                bounds: ComputerBounds(x: 0.25, y: 0.25, width: 0.5, height: 0.25)
            ),
        ])
        let ocr = SystemVisionOCR(backend: backend)

        let results = try await ocr.recognizeText(in: image(width: 200, height: 100), mode: .accurate)

        let candidate = try XCTUnwrap(results.first)
        XCTAssertEqual(candidate.text, "Submit")
        XCTAssertEqual(Double(try XCTUnwrap(candidate.confidence)), 0.95, accuracy: 0.0001)
        XCTAssertEqual(candidate.bounds, ComputerBounds(x: 50, y: 50, width: 100, height: 25))
        XCTAssertEqual(candidate.source, .accurate)
    }

    func testOcrDropsInvalidGeometryAndEmptyText() async throws {
        let backend = FakeVisionBackend(results: [
            rawObservation(text: "", confidence: 0.8, bounds: ComputerBounds(x: 0.1, y: 0.1, width: 0.2, height: 0.2)),
            rawObservation(text: "Offscreen", confidence: 0.8, bounds: ComputerBounds(x: 1.2, y: 0.1, width: 0.2, height: 0.2)),
            rawObservation(text: "Valid", confidence: 0.8, bounds: ComputerBounds(x: 0.1, y: 0.1, width: 0.2, height: 0.2)),
        ])
        let ocr = SystemVisionOCR(backend: backend)

        let results = try await ocr.recognizeText(in: image(width: 100, height: 100), mode: .fast)

        XCTAssertEqual(results.map(\.text), ["Valid"])
    }

    func testOcrResultModelDoesNotContainSemanticRoleField() async throws {
        let backend = FakeVisionBackend(results: [
            rawObservation(text: "Run", confidence: 1, bounds: ComputerBounds(x: 0, y: 0, width: 0.5, height: 0.5)),
        ])
        let ocr = SystemVisionOCR(backend: backend)
        let results = try await ocr.recognizeText(in: image(width: 20, height: 20), mode: .fast)

        let json = String(decoding: try JSONEncoder().encode(results), as: UTF8.self)
        XCTAssertFalse(json.contains("role"))
        XCTAssertFalse(json.contains("AXButton"))
    }

    private func rawObservation(
        text: String,
        confidence: Float,
        bounds: ComputerBounds
    ) -> VisionRawTextObservation {
        VisionRawTextObservation(text: text, confidence: confidence, normalizedBounds: bounds)
    }

    private func image(width: Int, height: Int) -> CGImage {
        let colorSpace = CGColorSpaceCreateDeviceRGB()
        let context = CGContext(
            data: nil,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: width * 4,
            space: colorSpace,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        )!
        return context.makeImage()!
    }
}

private struct FakeVisionBackend: VisionTextRecognitionBackend {
    let results: [VisionRawTextObservation]

    func recognize(in image: CGImage, mode: VisionRecognitionMode) async throws -> [VisionRawTextObservation] {
        results
    }
}
