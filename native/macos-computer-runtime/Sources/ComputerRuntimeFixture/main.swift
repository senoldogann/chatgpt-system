import AppKit
import ComputerRuntimeFixtureOracle
import Foundation

let oraclePath = ProcessInfo.processInfo.environment["CHATGPT_SYSTEM_COMPUTER_FLOW_FIXTURE_ORACLE_PATH"]
let oracleURL = oraclePath.flatMap { path in
    path.isEmpty ? nil : URL(fileURLWithPath: path)
}
let oracleStore: FixtureOracleStore
do {
    oracleStore = try FixtureOracleStore(fileURL: oracleURL)
} catch {
    fatalError("Fixture oracle initialization failed.")
}

let application = NSApplication.shared
let delegate = FixtureAppDelegate(oracleStore: oracleStore)
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
