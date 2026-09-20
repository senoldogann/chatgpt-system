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

        let screenSpace = candidates.compactMap { candidate -> ComputerOcrCandidateView? in
            guard let bounds = screenBounds(
                for: candidate.bounds,
                imageWidth: imageWidth,
                imageHeight: imageHeight,
                captureBounds: captureBounds
            ) else {
                return nil
            }
            return ComputerOcrCandidateView(
                text: candidate.text,
                bounds: bounds,
                confidence: candidate.confidence.map(Double.init),
                source: candidate.source == .fast ? .visionFast : .visionAccurate
            )
        }
        return boundedViewCandidates(screenSpace)
    }

    static func boundedViewCandidates(
        _ candidates: [ComputerOcrCandidateView]
    ) -> [ComputerOcrCandidateView] {
        var output: [ComputerOcrCandidateView] = []
        output.reserveCapacity(min(candidates.count, maxOcrCandidates))
        var aggregateScalars = 0

        for candidate in candidates {
            guard output.count < maxOcrCandidates else { break }
            if let confidence = candidate.confidence,
               (!confidence.isFinite || confidence < minimumOcrConfidence || confidence > 1) {
                continue
            }
            guard isValidScreenBounds(candidate.bounds) else { continue }

            let normalized = candidate.text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty else { continue }
            let remaining = maxOcrAggregateCharacters - aggregateScalars
            guard remaining > 0 else { break }
            let text = boundedScalarText(
                normalized,
                maxScalars: min(maxOcrCandidateCharacters, remaining)
            )
            guard !text.isEmpty else { continue }

            output.append(
                ComputerOcrCandidateView(
                    text: text,
                    bounds: candidate.bounds,
                    confidence: candidate.confidence,
                    source: candidate.source
                )
            )
            aggregateScalars += text.unicodeScalars.count
        }
        return output
    }

    static func boundedScalarText(_ value: String, maxScalars: Int) -> String {
        guard maxScalars > 0 else { return "" }
        var result = String()
        var scalarCount = 0
        for character in value {
            let characterScalars = character.unicodeScalars.count
            guard scalarCount + characterScalars <= maxScalars else { break }
            result.append(character)
            scalarCount += characterScalars
        }
        return result
    }

    private static func isValidScreenBounds(_ bounds: ComputerBounds) -> Bool {
        bounds.x.isFinite &&
            bounds.y.isFinite &&
            bounds.width.isFinite &&
            bounds.height.isFinite &&
            bounds.width > 0 &&
            bounds.height > 0
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
