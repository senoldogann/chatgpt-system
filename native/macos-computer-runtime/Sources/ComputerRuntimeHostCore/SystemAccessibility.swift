import ApplicationServices
import ComputerRuntimeCore
import CoreGraphics
import Foundation

public struct SystemAccessibilityReader: AccessibilityReading {
    private enum Attribute {
        static let role = "AXRole"
        static let subrole = "AXSubrole"
        static let title = "AXTitle"
        static let description = "AXDescription"
        static let focused = "AXFocused"
        static let enabled = "AXEnabled"
        static let selected = "AXSelected"
        static let position = "AXPosition"
        static let size = "AXSize"
        static let children = "AXChildren"
        static let focusedWindow = "AXFocusedWindow"
    }

    public init() {}

    public func activeWindow(for application: WorkspaceApplication) throws -> ActiveWindowView {
        let applicationElement = AXUIElementCreateApplication(application.processIdentifier)
        guard let window = try elementAttribute(Attribute.focusedWindow, from: applicationElement) else {
            throw AccessibilityReadError.unavailable
        }

        return ActiveWindowView(
            application: application.view,
            title: try stringAttribute(Attribute.title, from: window)
        )
    }

    public func observe(
        for application: WorkspaceApplication,
        limits: ObservationLimits
    ) throws -> ComputerObservation {
        let applicationElement = AXUIElementCreateApplication(application.processIdentifier)
        let focusedWindow = try elementAttribute(Attribute.focusedWindow, from: applicationElement)
        let root = focusedWindow ?? applicationElement
        let windowTitle = try focusedWindow.flatMap { try stringAttribute(Attribute.title, from: $0) }

        var elements: [ComputerElementView] = []
        var truncated = false
        try traverse(
            root,
            depth: 0,
            limits: limits,
            elements: &elements,
            truncated: &truncated
        )

        return ComputerObservation(
            snapshotId: UUID().uuidString,
            application: application.view,
            windowTitle: windowTitle,
            elements: elements,
            truncated: truncated
        )
    }

    private func traverse(
        _ element: AXUIElement,
        depth: Int,
        limits: ObservationLimits,
        elements: inout [ComputerElementView],
        truncated: inout Bool
    ) throws {
        guard elements.count < limits.maxElements else {
            truncated = true
            return
        }

        let index = elements.count
        let role = boundedText(try stringAttribute(Attribute.role, from: element)) ?? "AXUnknown"
        let bounds = try bounds(for: element)

        elements.append(
            ComputerElementView(
                index: index,
                role: role,
                subrole: boundedText(try stringAttribute(Attribute.subrole, from: element)),
                title: boundedText(try stringAttribute(Attribute.title, from: element)),
                description: boundedText(try stringAttribute(Attribute.description, from: element)),
                focused: try boolAttribute(Attribute.focused, from: element),
                enabled: try boolAttribute(Attribute.enabled, from: element),
                selected: try boolAttribute(Attribute.selected, from: element),
                bounds: bounds
            )
        )

        let children = try childrenAttribute(from: element)
        guard depth < limits.maxDepth else {
            if !children.isEmpty {
                truncated = true
            }
            return
        }

        for child in children {
            guard elements.count < limits.maxElements else {
                truncated = true
                return
            }
            try traverse(
                child,
                depth: depth + 1,
                limits: limits,
                elements: &elements,
                truncated: &truncated
            )
        }
    }

    private func bounds(for element: AXUIElement) throws -> ComputerBounds? {
        guard let position = try pointAttribute(Attribute.position, from: element),
              let size = try sizeAttribute(Attribute.size, from: element),
              position.x.isFinite,
              position.y.isFinite,
              size.width.isFinite,
              size.height.isFinite,
              size.width >= 0,
              size.height >= 0
        else {
            return nil
        }

        return ComputerBounds(
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height
        )
    }

    private func copyAttribute(_ name: String, from element: AXUIElement) throws -> CFTypeRef? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, name as CFString, &value)
        switch result {
        case .success:
            return value
        case .attributeUnsupported, .noValue:
            return nil
        case .apiDisabled:
            throw AccessibilityReadError.permissionRequired
        default:
            throw AccessibilityReadError.unavailable
        }
    }

    private func stringAttribute(_ name: String, from element: AXUIElement) throws -> String? {
        guard let value = try copyAttribute(name, from: element) else {
            return nil
        }
        return value as? String
    }

    private func boolAttribute(_ name: String, from element: AXUIElement) throws -> Bool? {
        guard let value = try copyAttribute(name, from: element) else {
            return nil
        }
        return value as? Bool
    }

    private func elementAttribute(_ name: String, from element: AXUIElement) throws -> AXUIElement? {
        guard let value = try copyAttribute(name, from: element),
              CFGetTypeID(value) == AXUIElementGetTypeID()
        else {
            return nil
        }
        return unsafeDowncast(value, to: AXUIElement.self)
    }

    private func childrenAttribute(from element: AXUIElement) throws -> [AXUIElement] {
        guard let value = try copyAttribute(Attribute.children, from: element),
              let values = value as? [Any]
        else {
            return []
        }

        return values.compactMap { candidate in
            let object = candidate as CFTypeRef
            guard CFGetTypeID(object) == AXUIElementGetTypeID() else {
                return nil
            }
            return unsafeDowncast(object, to: AXUIElement.self)
        }
    }

    private func pointAttribute(_ name: String, from element: AXUIElement) throws -> CGPoint? {
        guard let value = try copyAttribute(name, from: element),
              CFGetTypeID(value) == AXValueGetTypeID()
        else {
            return nil
        }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgPoint else {
            return nil
        }
        var point = CGPoint.zero
        guard AXValueGetValue(axValue, .cgPoint, &point) else {
            return nil
        }
        return point
    }

    private func sizeAttribute(_ name: String, from element: AXUIElement) throws -> CGSize? {
        guard let value = try copyAttribute(name, from: element),
              CFGetTypeID(value) == AXValueGetTypeID()
        else {
            return nil
        }
        let axValue = unsafeDowncast(value, to: AXValue.self)
        guard AXValueGetType(axValue) == .cgSize else {
            return nil
        }
        var size = CGSize.zero
        guard AXValueGetValue(axValue, .cgSize, &size) else {
            return nil
        }
        return size
    }
}
