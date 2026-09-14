import ComputerRuntimeCore

struct ComputerPerception {
    static let chromeBundleIdentifier = "com.google.Chrome"

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
        observation.elements.first(where: { $0.role == "AXWindow" && $0.focused != false })?.bounds
            ?? observation.elements.first(where: { $0.role == "AXWindow" })?.bounds
    }
}
