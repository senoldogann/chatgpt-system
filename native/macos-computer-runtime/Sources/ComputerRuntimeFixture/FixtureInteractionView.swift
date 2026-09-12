import AppKit

@MainActor
final class FixtureInteractionView: NSView, NSTextFieldDelegate {
    private let statusLabel = NSTextField(labelWithString: "ready")
    private let focusLabel = NSTextField(labelWithString: "focus:none")
    private let textField = NSTextField(string: "fixture")
    private let checkbox = NSButton(checkboxWithTitle: "Fixture Checkbox", target: nil, action: nil)
    private let reorderContainer = NSView(frame: NSRect(x: 30, y: 282, width: 350, height: 36))
    private let visualSubmit = FixtureVisualSubmitView(frame: NSRect(x: 400, y: 236, width: 340, height: 52))
    private var reorderGeneration = 0

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        buildInterface()
    }

    required init?(coder: NSCoder) {
        nil
    }

    @objc func fixtureHotkey(_ sender: Any?) {
        setStatus("hotkey-ok")
    }

    @objc private func buttonPressed(_ sender: NSButton) {
        setStatus("button-clicked")
    }

    @objc private func duplicateActionPressed(_ sender: NSButton) {
        setStatus("duplicate-clicked")
    }

    @objc private func reorderTargetsPressed(_ sender: NSButton) {
        reorderGeneration += 1
        rebuildReorderTargets()
        setStatus("reordered-generation:\(reorderGeneration)")
    }

    @objc private func reorderTargetPressed(_ sender: NSButton) {
        setStatus("reorder-target:\(sender.title)")
    }

    @objc private func checkboxChanged(_ sender: NSButton) {
        setStatus(sender.state == .on ? "checkbox:on" : "checkbox:off")
    }

    func controlTextDidChange(_ obj: Notification) {
        setStatus("text:\(textField.stringValue)")
    }

    func controlTextDidBeginEditing(_ obj: Notification) {
        focusLabel.stringValue = "focus:text-field"
        focusLabel.setAccessibilityTitle("focus:text-field")
    }

    func controlTextDidEndEditing(_ obj: Notification) {
        focusLabel.stringValue = "focus:none"
        focusLabel.setAccessibilityTitle("focus:none")
    }

    private func buildInterface() {
        let title = NSTextField(labelWithString: "Computer Runtime v2 Fixture")
        title.font = .boldSystemFont(ofSize: 22)
        title.frame = NSRect(x: 30, y: 548, width: 420, height: 30)
        addSubview(title)

        statusLabel.frame = NSRect(x: 30, y: 505, width: 420, height: 28)
        statusLabel.font = .systemFont(ofSize: 16)
        statusLabel.setAccessibilityLabel("Fixture Status")
        statusLabel.setAccessibilityTitle("ready")
        statusLabel.setAccessibilityHelp("Deterministic fixture interaction status")
        addSubview(statusLabel)

        focusLabel.frame = NSRect(x: 470, y: 505, width: 270, height: 28)
        focusLabel.setAccessibilityLabel("Fixture Focus Indicator")
        focusLabel.setAccessibilityTitle("focus:none")
        addSubview(focusLabel)

        let button = NSButton(title: "Fixture Button", target: self, action: #selector(buttonPressed(_:)))
        button.frame = NSRect(x: 30, y: 445, width: 160, height: 36)
        button.bezelStyle = .rounded
        button.setAccessibilityLabel("Fixture Button")
        addSubview(button)

        let doubleClick = FixtureDoubleClickView(frame: NSRect(x: 220, y: 435, width: 170, height: 52))
        doubleClick.onDoubleClick = { [weak self] in self?.setStatus("double-clicked") }
        doubleClick.setAccessibilityElement(true)
        doubleClick.setAccessibilityRole(.button)
        doubleClick.setAccessibilityLabel("Fixture Double Click Target")
        doubleClick.setAccessibilityTitle("Fixture Double Click Target")
        addSubview(doubleClick)

        checkbox.frame = NSRect(x: 420, y: 445, width: 180, height: 32)
        checkbox.target = self
        checkbox.action = #selector(checkboxChanged(_:))
        checkbox.setAccessibilityLabel("Fixture Checkbox")
        addSubview(checkbox)

        textField.frame = NSRect(x: 30, y: 375, width: 300, height: 30)
        textField.delegate = self
        textField.setAccessibilityLabel("Fixture Text Field")
        textField.setAccessibilityTitle("Fixture Text Field")
        addSubview(textField)

        let dragView = FixtureDragView(frame: NSRect(x: 360, y: 330, width: 380, height: 100))
        dragView.onComplete = { [weak self] in self?.setStatus("drag-complete") }
        dragView.setAccessibilityElement(true)
        dragView.setAccessibilityRole(.group)
        dragView.setAccessibilityLabel("Fixture Drag Target")
        dragView.setAccessibilityTitle("Fixture Drag Target")
        addSubview(dragView)

        let firstDuplicate = NSButton(
            title: "Duplicate Action 1",
            target: self,
            action: #selector(duplicateActionPressed(_:))
        )
        firstDuplicate.frame = NSRect(x: 30, y: 330, width: 160, height: 32)
        firstDuplicate.bezelStyle = .rounded
        firstDuplicate.setAccessibilityLabel("Duplicate Action")
        addSubview(firstDuplicate)

        let secondDuplicate = NSButton(
            title: "Duplicate Action 2",
            target: self,
            action: #selector(duplicateActionPressed(_:))
        )
        secondDuplicate.frame = NSRect(x: 200, y: 330, width: 160, height: 32)
        secondDuplicate.bezelStyle = .rounded
        secondDuplicate.setAccessibilityLabel("Duplicate Action")
        addSubview(secondDuplicate)

        let reorder = NSButton(title: "Reorder Targets", target: self, action: #selector(reorderTargetsPressed(_:)))
        reorder.frame = NSRect(x: 400, y: 330, width: 170, height: 32)
        reorder.bezelStyle = .rounded
        reorder.setAccessibilityLabel("Reorder Targets")
        reorder.setAccessibilityTitle("Reorder Targets")
        addSubview(reorder)

        addSubview(reorderContainer)
        rebuildReorderTargets()

        visualSubmit.onSubmit = { [weak self] in self?.setStatus("visual-submit-clicked") }
        addSubview(visualSubmit)

        let scrollView = NSScrollView(frame: NSRect(x: 30, y: 30, width: 710, height: 195))
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = true
        scrollView.autohidesScrollers = false
        scrollView.setAccessibilityLabel("Fixture Scroll View")

        let document = NSView(frame: NSRect(x: 0, y: 0, width: 1_200, height: 900))
        for index in 0..<30 {
            let row = NSTextField(labelWithString: "fixture-scroll-row-\(index)")
            row.frame = NSRect(x: 20, y: 860 - (index * 28), width: 1_100, height: 22)
            document.addSubview(row)
        }
        scrollView.documentView = document
        addSubview(scrollView)
    }

    private func rebuildReorderTargets() {
        for subview in reorderContainer.subviews { subview.removeFromSuperview() }
        let ordered = reorderGeneration.isMultiple(of: 2)
            ? ["Reorder Alpha", "Reorder Beta"]
            : ["Reorder Beta", "Reorder Alpha"]
        for (index, title) in ordered.enumerated() {
            let button = NSButton(title: title, target: self, action: #selector(reorderTargetPressed(_:)))
            button.frame = NSRect(x: CGFloat(index) * 175, y: 0, width: 165, height: 32)
            button.bezelStyle = .rounded
            button.setAccessibilityLabel(title)
            button.setAccessibilityTitle(title)
            reorderContainer.addSubview(button)
        }
    }

    private func setStatus(_ value: String) {
        statusLabel.stringValue = value
        statusLabel.setAccessibilityTitle(value)
        statusLabel.setAccessibilityValue(value)
    }
}

@MainActor
private final class FixtureDoubleClickView: NSView {
    var onDoubleClick: (() -> Void)?

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.controlBackgroundColor.setFill()
        bounds.fill()
        NSColor.separatorColor.setStroke()
        NSBezierPath(rect: bounds.insetBy(dx: 1, dy: 1)).stroke()
        let text = "Double-click target"
        text.draw(at: NSPoint(x: 14, y: 16), withAttributes: [.font: NSFont.systemFont(ofSize: 14)])
    }

    override func mouseDown(with event: NSEvent) {
        if event.clickCount >= 2 {
            onDoubleClick?()
        }
    }
}

@MainActor
private final class FixtureDragView: NSView {
    var onComplete: (() -> Void)?
    private let sourceRect = NSRect(x: 20, y: 20, width: 90, height: 60)
    private let destinationRect = NSRect(x: 270, y: 20, width: 90, height: 60)
    private var beganInSource = false

    override var isFlipped: Bool { true }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.controlBackgroundColor.setFill()
        bounds.fill()
        NSColor.systemBlue.withAlphaComponent(0.25).setFill()
        sourceRect.fill()
        NSColor.systemGreen.withAlphaComponent(0.25).setFill()
        destinationRect.fill()
        "drag-source".draw(at: NSPoint(x: 28, y: 40), withAttributes: [.font: NSFont.systemFont(ofSize: 12)])
        "drag-destination".draw(at: NSPoint(x: 275, y: 40), withAttributes: [.font: NSFont.systemFont(ofSize: 12)])
    }

    override func mouseDown(with event: NSEvent) {
        let point = convert(event.locationInWindow, from: nil)
        beganInSource = sourceRect.contains(point)
    }

    override func mouseUp(with event: NSEvent) {
        defer { beganInSource = false }
        guard beganInSource else { return }
        let point = convert(event.locationInWindow, from: nil)
        if destinationRect.contains(point) {
            onComplete?()
        }
    }
}

@MainActor
private final class FixtureVisualSubmitView: NSView {
    var onSubmit: (() -> Void)?
    private var submitted = false

    override var isFlipped: Bool { true }

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        // OCR-only target: deliberately carries no accessibility identity.
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) {
        nil
    }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        NSColor.white.setFill()
        bounds.fill()
        NSColor.black.setStroke()
        NSBezierPath(rect: bounds.insetBy(dx: 1, dy: 1)).stroke()
        "Fixture Visual Submit".draw(
            at: NSPoint(x: 14, y: 16),
            withAttributes: [
                .font: NSFont.boldSystemFont(ofSize: 18),
                .foregroundColor: NSColor.black,
            ]
        )
        (submitted ? NSColor.systemGreen : NSColor.systemRed).setFill()
        NSRect(x: bounds.width - 48, y: 12, width: 34, height: 28).fill()
    }

    override func mouseDown(with event: NSEvent) {
        submitted = true
        needsDisplay = true
        onSubmit?()
    }
}
