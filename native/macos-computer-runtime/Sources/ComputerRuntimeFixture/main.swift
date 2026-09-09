import AppKit

let application = NSApplication.shared
let delegate = FixtureAppDelegate()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
