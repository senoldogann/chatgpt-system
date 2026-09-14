import ComputerRuntimeCore
import CryptoKit
import Foundation

struct ComputerTargetResolutionContext: Sendable {
    let cached: CachedComputerObservation
    let currentDisplayTopologyDigest: String
    let activeDisplays: [ComputerBounds]
}

enum ComputerTargetResolutionError: Error, Equatable, Sendable {
    case notFound
    case ambiguous
    case staleSnapshot
    case unsafeGeometry
}

struct ComputerTargetResolver: Sendable {
    func resolve(
        target: ComputerTarget,
        in context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget {
        if case let .point(x, y) = target {
            return try resolvePoint(x: x, y: y, context: context)
        }

        guard context.cached.displayTopologyDigest == context.currentDisplayTopologyDigest else {
            throw ComputerTargetResolutionError.staleSnapshot
        }

        switch target {
        case let .index(snapshotId, index):
            guard snapshotId == context.cached.observationId,
                  snapshotId == context.cached.observation.snapshotId,
                  let element = context.cached.observation.elements.first(where: { $0.index == index })
            else {
                throw ComputerTargetResolutionError.staleSnapshot
            }
            return try resolvedAXTarget(from: element, context: context)

        case let .role(role, name, exact):
            return try resolveUniqueAX(
                in: context,
                matches: { element in
                    guard element.role == role else { return false }
                    guard let name else { return true }
                    return Self.matchesText(name, exact: exact, candidates: [element.title, element.description])
                }
            )

        case let .text(text, exact):
            return try resolveUniqueAX(
                in: context,
                matches: { element in
                    Self.matchesText(text, exact: exact, candidates: [element.title, element.description])
                }
            )

        case let .label(label, exact):
            return try resolveUniqueAX(
                in: context,
                matches: { element in
                    Self.matchesText(label, exact: exact, candidates: [element.title, element.description])
                }
            )

        case .ocrText:
            throw ComputerTargetResolutionError.notFound

        case let .scoped(baseTarget, within):
            let scope = try resolveScopeElement(within, in: context)
            return try resolveScoped(baseTarget, within: scope.index, in: context)

        case .point:
            preconditionFailure("Point targets are resolved before cached AX validation.")
        }
    }

    func resolveMany(
        targets: [ComputerTarget],
        in context: ComputerTargetResolutionContext
    ) throws -> [ResolvedComputerTarget] {
        try targets.map { try resolve(target: $0, in: context) }
    }

    func resolveScope(
        _ scope: ComputerTargetScope,
        in context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget {
        guard context.cached.displayTopologyDigest == context.currentDisplayTopologyDigest else {
            throw ComputerTargetResolutionError.staleSnapshot
        }
        return try resolvedAXTarget(from: resolveScopeElement(scope, in: context), context: context)
    }

    private func resolveScoped(
        _ target: ComputerTarget,
        within scopeIndex: Int,
        in context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget {
        switch target {
        case let .index(snapshotId, index):
            guard snapshotId == context.cached.observationId,
                  snapshotId == context.cached.observation.snapshotId,
                  let element = context.cached.observation.elements.first(where: { $0.index == index })
            else {
                throw ComputerTargetResolutionError.staleSnapshot
            }
            guard Self.isDescendant(
                element,
                of: scopeIndex,
                elements: context.cached.observation.elements
            ) else {
                throw ComputerTargetResolutionError.notFound
            }
            return try resolvedAXTarget(from: element, context: context)

        case let .role(role, name, exact):
            return try resolveUniqueAX(
                in: context,
                scopeIndex: scopeIndex,
                matches: { element in
                    guard element.role == role else { return false }
                    guard let name else { return true }
                    return Self.matchesText(name, exact: exact, candidates: [element.title, element.description])
                }
            )

        case let .text(text, exact):
            return try resolveUniqueAX(
                in: context,
                scopeIndex: scopeIndex,
                matches: { element in
                    Self.matchesText(text, exact: exact, candidates: [element.title, element.description])
                }
            )

        case let .label(label, exact):
            return try resolveUniqueAX(
                in: context,
                scopeIndex: scopeIndex,
                matches: { element in
                    Self.matchesText(label, exact: exact, candidates: [element.title, element.description])
                }
            )

        case .ocrText:
            throw ComputerTargetResolutionError.notFound
        case .point, .scoped:
            throw ComputerTargetResolutionError.notFound
        }
    }

    private func resolveScopeElement(
        _ scope: ComputerTargetScope,
        in context: ComputerTargetResolutionContext
    ) throws -> ComputerElementView {
        switch scope {
        case let .index(snapshotId, index):
            guard snapshotId == context.cached.observationId,
                  snapshotId == context.cached.observation.snapshotId,
                  let element = context.cached.observation.elements.first(where: { $0.index == index })
            else {
                throw ComputerTargetResolutionError.staleSnapshot
            }
            return element
        case let .role(role, name, exact):
            return try resolveUniqueAXElement(
                in: context,
                scopeIndex: nil,
                matches: { element in
                    guard element.role == role else { return false }
                    guard let name else { return true }
                    return Self.matchesText(name, exact: exact, candidates: [element.title, element.description])
                }
            )
        }
    }

    private func resolveUniqueAX(
        in context: ComputerTargetResolutionContext,
        scopeIndex: Int? = nil,
        matches: (ComputerElementView) -> Bool
    ) throws -> ResolvedComputerTarget {
        try resolvedAXTarget(
            from: resolveUniqueAXElement(in: context, scopeIndex: scopeIndex, matches: matches),
            context: context
        )
    }

    private func resolveUniqueAXElement(
        in context: ComputerTargetResolutionContext,
        scopeIndex: Int?,
        matches: (ComputerElementView) -> Bool
    ) throws -> ComputerElementView {
        let elements = context.cached.observation.elements
        let matching = elements.filter { element in
            guard matches(element) else { return false }
            guard let scopeIndex else { return true }
            return Self.isDescendant(element, of: scopeIndex, elements: elements)
        }
        let enabled = matching.filter { $0.enabled != false }

        guard !enabled.isEmpty else {
            throw ComputerTargetResolutionError.notFound
        }
        guard enabled.count == 1, let element = enabled.first else {
            throw ComputerTargetResolutionError.ambiguous
        }
        return element
    }

    private func resolvedAXTarget(
        from element: ComputerElementView,
        context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget {
        guard element.enabled != false else {
            throw ComputerTargetResolutionError.notFound
        }
        guard let bounds = element.bounds,
              Self.isSafe(bounds: bounds, insideAny: context.activeDisplays)
        else {
            throw ComputerTargetResolutionError.unsafeGeometry
        }

        let point = ComputerPoint(
            x: bounds.x + (bounds.width / 2),
            y: bounds.y + (bounds.height / 2)
        )
        return ResolvedComputerTarget(
            source: .ax,
            bounds: bounds,
            actionPoint: point,
            observationId: context.cached.observationId,
            appIdentity: context.cached.appIdentity,
            windowIdentity: context.cached.windowIdentity,
            windowGeneration: context.cached.windowGeneration,
            displayTopologyDigest: context.currentDisplayTopologyDigest,
            confidence: .deterministic,
            semanticFingerprint: Self.semanticFingerprint(for: element)
        )
    }

    private func resolvePoint(
        x: Double,
        y: Double,
        context: ComputerTargetResolutionContext
    ) throws -> ResolvedComputerTarget {
        guard x.isFinite,
              y.isFinite,
              context.activeDisplays.contains(where: { Self.contains(pointX: x, y: y, display: $0) })
        else {
            throw ComputerTargetResolutionError.unsafeGeometry
        }

        return ResolvedComputerTarget(
            source: .point,
            bounds: ComputerBounds(x: x, y: y, width: 1, height: 1),
            actionPoint: ComputerPoint(x: x, y: y),
            observationId: nil,
            appIdentity: context.cached.appIdentity,
            windowIdentity: context.cached.windowIdentity,
            windowGeneration: context.cached.windowGeneration,
            displayTopologyDigest: context.currentDisplayTopologyDigest,
            confidence: .explicit,
            semanticFingerprint: nil
        )
    }

    private static func isDescendant(
        _ element: ComputerElementView,
        of ancestorIndex: Int,
        elements: [ComputerElementView]
    ) -> Bool {
        let byIndex = Dictionary(uniqueKeysWithValues: elements.map { ($0.index, $0) })
        var parent = element.parentIndex
        var visited: Set<Int> = []
        while let parentIndex = parent {
            guard visited.insert(parentIndex).inserted else { return false }
            if parentIndex == ancestorIndex { return true }
            guard let parentElement = byIndex[parentIndex] else { return false }
            parent = parentElement.parentIndex
        }
        return false
    }

    private static func matchesText(
        _ query: String,
        exact: Bool,
        candidates: [String?]
    ) -> Bool {
        let normalizedQuery = normalize(query, lowercased: !exact)
        guard !normalizedQuery.isEmpty else { return false }
        return candidates.compactMap { $0 }.contains { candidate in
            let normalizedCandidate = normalize(candidate, lowercased: !exact)
            return exact
                ? normalizedCandidate == normalizedQuery
                : normalizedCandidate.contains(normalizedQuery)
        }
    }

    private static func normalize(_ value: String, lowercased: Bool) -> String {
        let collapsed = value
            .prefix(4096)
            .split(whereSeparator: { $0.isWhitespace })
            .joined(separator: " ")
        return lowercased ? collapsed.lowercased() : collapsed
    }

    private static func isSafe(bounds: ComputerBounds, insideAny displays: [ComputerBounds]) -> Bool {
        guard bounds.x.isFinite,
              bounds.y.isFinite,
              bounds.width.isFinite,
              bounds.height.isFinite,
              bounds.width > 0,
              bounds.height > 0
        else {
            return false
        }
        return displays.contains { display in
            guard display.x.isFinite,
                  display.y.isFinite,
                  display.width.isFinite,
                  display.height.isFinite,
                  display.width > 0,
                  display.height > 0
            else {
                return false
            }
            return bounds.x >= display.x &&
                bounds.y >= display.y &&
                bounds.x + bounds.width <= display.x + display.width &&
                bounds.y + bounds.height <= display.y + display.height
        }
    }

    private static func contains(pointX x: Double, y: Double, display: ComputerBounds) -> Bool {
        guard display.x.isFinite,
              display.y.isFinite,
              display.width.isFinite,
              display.height.isFinite,
              display.width > 0,
              display.height > 0
        else {
            return false
        }
        return x >= display.x &&
            y >= display.y &&
            x < display.x + display.width &&
            y < display.y + display.height
    }

    private static func semanticFingerprint(for element: ComputerElementView) -> String {
        let bounds = element.bounds.map {
            "\($0.x),\($0.y),\($0.width),\($0.height)"
        } ?? "none"
        let payload = [
            element.role,
            element.subrole ?? "",
            element.title ?? "",
            element.description ?? "",
            element.enabled.map(String.init) ?? "nil",
            element.selected.map(String.init) ?? "nil",
            bounds,
        ].joined(separator: "\u{1f}")
        let digest = SHA256.hash(data: Data(payload.utf8))
        return digest.map { String(format: "%02x", $0) }.joined()
    }
}
