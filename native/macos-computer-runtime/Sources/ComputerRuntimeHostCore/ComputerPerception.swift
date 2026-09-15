import ComputerRuntimeCore
import Foundation

struct ComputerPerception {
    static let chromeBundleIdentifier = "com.google.Chrome"
    static let maxOcrCandidates = 64
    static let maxOcrCandidateCharacters = 512
    static let maxOcrAggregateCharacters = 8_192
    static let minimumOcrConfidence = 0.5

    static func classify(observation: ComputerObservation) -> ComputerPerceptionSummary {
        let isChrome = observation.application.bundleIdentifier == chromeBundleIdentifier
        let hasWebArea = observation.elements.contains { $0.role == "AXWebArea" }

        let quality: ComputerAXQuality
        if isChrome && !hasWebArea {
            quality = .weak
        } else if observation.elements.isEmpty {
            quality = .weak
        } else if observation.truncated {
            quality = .partial
        } else {
            quality = .strong
        }

        return ComputerPerceptionSummary(
            axQuality: quality,
            webContentAccessible: isChrome ? hasWebArea : nil,
            ocrUsed: false,
            recommendedTargeting: quality == .weak ? .ocr : .ax,
            ocrCandidates: []
        )
    }

    static func focusedWindowBounds(in observation: ComputerObservation) -> ComputerBounds? {
        observation.elements.first(where: { $0.role == "AXWindow" && $0.focused == true })?.bounds
            ?? observation.elements.first(where: { $0.role == "AXWindow" })?.bounds
    }

    static func summary(
        base: ComputerPerceptionSummary,
        ocrCandidates: [ComputerOcrCandidateView],
        ocrUsed: Bool
    ) -> ComputerPerceptionSummary {
        let targeting: ComputerRecommendedTargeting
        if base.axQuality != .weak {
            targeting = .ax
        } else if !ocrCandidates.isEmpty {
            targeting = .ocr
        } else {
            targeting = .visualPoint
        }
        return ComputerPerceptionSummary(
            axQuality: base.axQuality,
            webContentAccessible: base.webContentAccessible,
            ocrUsed: ocrUsed,
            recommendedTargeting: targeting,
            ocrCandidates: ocrCandidates
        )
    }

    static func boundedCandidates(
        _ candidates: [OcrTextCandidate],
        imageWidth: Int,
        imageHeight: Int,
        captureBounds: ComputerBounds
    ) -> [ComputerOcrCandidateView] {
        guard imageWidth > 0, imageHeight > 0 else { return [] }

        var output: [ComputerOcrCandidateView] = []
        output.reserveCapacity(min(candidates.count, maxOcrCandidates))
        var aggregateCharacters = 0

        for candidate in candidates {
            guard output.count < maxOcrCandidates else { break }
            if let confidence = candidate.confidence,
               (!confidence.isFinite || Double(confidence) < minimumOcrConfidence) {
                continue
            }

            let normalized = candidate.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty else { continue }
            let remaining = maxOcrAggregateCharacters - aggregateCharacters
            guard remaining > 0 else { break }
            let textLimit = min(maxOcrCandidateCharacters, remaining)
            let text = String(normalized.prefix(textLimit))
            guard !text.isEmpty,
                  let bounds = screenBounds(
                    for: candidate.bounds,
                    imageWidth: imageWidth,
                    imageHeight: imageHeight,
                    captureBounds: captureBounds
                  )
            else {
                continue
            }

            output.append(
                ComputerOcrCandidateView(
                    text: text,
                    bounds: bounds,
                    confidence: candidate.confidence.map(Double.init),
                    source: candidate.source == .fast ? .visionFast : .visionAccurate
                )
            )
            aggregateCharacters += text.count
        }
        return output
    }

    static func screenBounds(
        for imageBounds: ComputerBounds,
        imageWidth: Int,
        imageHeight: Int,
        captureBounds: ComputerBounds
    ) -> ComputerBounds? {
        guard imageWidth > 0,
              imageHeight > 0,
              imageBounds.x.isFinite,
              imageBounds.y.isFinite,
              imageBounds.width.isFinite,
              imageBounds.height.isFinite,
              imageBounds.x >= 0,
              imageBounds.y >= 0,
              imageBounds.width > 0,
              imageBounds.height > 0,
              imageBounds.x + imageBounds.width <= Double(imageWidth),
              imageBounds.y + imageBounds.height <= Double(imageHeight),
              captureBounds.x.isFinite,
              captureBounds.y.isFinite,
              captureBounds.width.isFinite,
              captureBounds.height.isFinite,
              captureBounds.width > 0,
              captureBounds.height > 0
        else {
            return nil
        }

        let scaleX = captureBounds.width / Double(imageWidth)
        let scaleY = captureBounds.height / Double(imageHeight)
        return ComputerBounds(
            x: captureBounds.x + imageBounds.x * scaleX,
            y: captureBounds.y + imageBounds.y * scaleY,
            width: imageBounds.width * scaleX,
            height: imageBounds.height * scaleY
        )
    }
}
