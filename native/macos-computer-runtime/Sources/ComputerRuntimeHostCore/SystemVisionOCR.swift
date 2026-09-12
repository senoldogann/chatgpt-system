import ComputerRuntimeCore
import CoreGraphics
import Foundation
import Vision

struct VisionRawTextObservation: Equatable, Sendable {
    let text: String
    let confidence: Float
    let normalizedBounds: ComputerBounds
}

protocol VisionTextRecognitionBackend: Sendable {
    func recognize(
        in image: CGImage,
        mode: VisionRecognitionMode
    ) async throws -> [VisionRawTextObservation]
}

struct SystemVisionTextRecognitionBackend: VisionTextRecognitionBackend {
    func recognize(
        in image: CGImage,
        mode: VisionRecognitionMode
    ) async throws -> [VisionRawTextObservation] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = mode == .fast ? .fast : .accurate
        request.usesLanguageCorrection = mode == .accurate
        request.automaticallyDetectsLanguage = true

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try handler.perform([request])

        return (request.results ?? []).compactMap { observation in
            guard let candidate = observation.topCandidates(1).first else {
                return nil
            }
            let bounds = observation.boundingBox
            return VisionRawTextObservation(
                text: candidate.string,
                confidence: candidate.confidence,
                normalizedBounds: ComputerBounds(
                    x: bounds.origin.x,
                    y: bounds.origin.y,
                    width: bounds.width,
                    height: bounds.height
                )
            )
        }
    }
}

struct SystemVisionOCR: VisionTextRecognizing, Sendable {
    private static let maxCandidates = 256
    private static let maxTextCharacters = 4_096

    private let backend: any VisionTextRecognitionBackend

    init(backend: any VisionTextRecognitionBackend = SystemVisionTextRecognitionBackend()) {
        self.backend = backend
    }

    func recognizeText(
        in image: CGImage,
        mode: VisionRecognitionMode
    ) async throws -> [OcrTextCandidate] {
        let raw = try await backend.recognize(in: image, mode: mode)
        let observationId = UUID().uuidString
        var output: [OcrTextCandidate] = []
        output.reserveCapacity(min(raw.count, Self.maxCandidates))

        for candidate in raw {
            guard output.count < Self.maxCandidates else { break }
            let text = String(
                candidate.text
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .prefix(Self.maxTextCharacters)
            )
            guard !text.isEmpty,
                  let bounds = Self.pixelBounds(
                    normalized: candidate.normalizedBounds,
                    imageWidth: image.width,
                    imageHeight: image.height
                  )
            else {
                continue
            }
            output.append(
                OcrTextCandidate(
                    text: text,
                    bounds: bounds,
                    confidence: candidate.confidence.isFinite ? candidate.confidence : nil,
                    source: mode,
                    observationId: observationId
                )
            )
        }
        return output
    }

    static func pixelBounds(
        normalized: ComputerBounds,
        imageWidth: Int,
        imageHeight: Int
    ) -> ComputerBounds? {
        guard imageWidth > 0,
              imageHeight > 0,
              normalized.x.isFinite,
              normalized.y.isFinite,
              normalized.width.isFinite,
              normalized.height.isFinite,
              normalized.x >= 0,
              normalized.y >= 0,
              normalized.width > 0,
              normalized.height > 0,
              normalized.x + normalized.width <= 1,
              normalized.y + normalized.height <= 1
        else {
            return nil
        }

        let width = Double(imageWidth)
        let height = Double(imageHeight)
        return ComputerBounds(
            x: normalized.x * width,
            y: (1 - normalized.y - normalized.height) * height,
            width: normalized.width * width,
            height: normalized.height * height
        )
    }
}
