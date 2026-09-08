import Foundation
import Security

private func fail(_ message: String, status: OSStatus? = nil) -> Never {
    var text = message
    if let status {
        let detail = SecCopyErrorMessageString(status, nil) as String? ?? "OSStatus \(status)"
        text += ": \(detail)"
    }
    FileHandle.standardError.write(Data((text + "\n").utf8))
    exit(1)
}

let arguments = CommandLine.arguments

guard arguments.count == 4, arguments[1] == "store" else {
    fail("Usage: chatgpt-system-keychain-helper store <account> <service>")
}

let account = arguments[2]
let service = arguments[3]
let credential = FileHandle.standardInput.readDataToEndOfFile()

guard !credential.isEmpty else {
    fail("Credential stdin must not be empty")
}

let query: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrAccount: account,
    kSecAttrService: service,
]

let updateStatus = SecItemUpdate(
    query as CFDictionary,
    [kSecValueData: credential] as CFDictionary
)

if updateStatus == errSecSuccess {
    exit(0)
}

if updateStatus != errSecItemNotFound {
    fail("Unable to update Keychain item", status: updateStatus)
}

var newItem = query
newItem[kSecValueData] = credential
let addStatus = SecItemAdd(newItem as CFDictionary, nil)

guard addStatus == errSecSuccess else {
    fail("Unable to add Keychain item", status: addStatus)
}
