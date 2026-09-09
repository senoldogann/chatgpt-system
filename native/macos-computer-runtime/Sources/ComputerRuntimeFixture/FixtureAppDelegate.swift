import AppKit

@MainActor
final class FixtureAppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow?
    private var interactionView: FixtureInteractionView?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let contentRect = NSRect(x: 0, y: 0, width: 800, height: 600)
        let window = NSWindow(
            contentRect: contentRect,
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Computer Runtime v2 Fixture"
        window.minSize = NSSize(width: 800, height: 600)
        window.setContentSize(contentRect.size)
        window.center()

        let interactionView = FixtureInteractionView(frame: contentRect)
        interactionView.autoresizingMask = [.width, .height]
        window.contentView = interactionView

        self.window = window
        self.interactionView = interactionView
        installMenu(target: interactionView)

        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func installMenu(target: FixtureInteractionView) {
        let mainMenu = NSMenu()
        let appItem = NSMenuItem()
        mainMenu.addItem(appItem)

        let appMenu = NSMenu()
        let hotkey = NSMenuItem(
            title: "Fixture Hotkey",
            action: #selector(FixtureInteractionView.fixtureHotkey(_:)),
            keyEquivalent: "k"
        )
        hotkey.keyEquivalentModifierMask = [.command, .shift]
        hotkey.target = target
        appMenu.addItem(hotkey)
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Quit Fixture", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu
        NSApp.mainMenu = mainMenu
    }
}
