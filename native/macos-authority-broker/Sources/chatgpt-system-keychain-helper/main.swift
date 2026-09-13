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

private func validatedName(_ value: String, label: String) -> String {
    let count = value.utf8.count
    guard count >= 1 && count <= 256 else {
        fail("\(label) must contain 1-256 UTF-8 bytes")
    }
    return value
}

let arguments = CommandLine.arguments
guard arguments.count == 4 else {
    fail("Usage: chatgpt-system-keychain-helper <store|read|delete> <account> <service>")
}

let operation = arguments[1]
let account = validatedName(arguments[2], label: "Account")
let service = validatedName(arguments[3], label: "Service")
let baseQuery: [CFString: Any] = [
    kSecClass: kSecClassGenericPassword,
    kSecAttrAccount: account,
    kSecAttrService: service,
]

switch operation {
case "store":
    let credential = FileHandle.standardInput.readDataToEndOfFile()
    guard !credential.isEmpty else {
        fail("Credential stdin must not be empty")
    }

    var updateQuery = baseQuery
    updateQuery[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
    let updateStatus = SecItemUpdate(
        updateQuery as CFDictionary,
        [kSecValueData: credential] as CFDictionary
    )

    if updateStatus == errSecSuccess {
        exit(0)
    }
    if updateStatus != errSecItemNotFound {
        fail("Unable to update Keychain item", status: updateStatus)
    }

    var newItem = baseQuery
    newItem[kSecValueData] = credential
    let addStatus = SecItemAdd(newItem as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
        fail("Unable to add Keychain item", status: addStatus)
    }

case "read":
    var readQuery = baseQuery
    readQuery[kSecReturnData] = true
    readQuery[kSecMatchLimit] = kSecMatchLimitOne
    readQuery[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
    var item: CFTypeRef?
    let status = SecItemCopyMatching(readQuery as CFDictionary, &item)
    guard status == errSecSuccess else {
        fail("Unable to read Keychain item", status: status)
    }
    guard let data = item as? Data, !data.isEmpty else {
        fail("Keychain item did not contain credential data")
    }
    FileHandle.standardOutput.write(data)

case "delete":
    var deleteQuery = baseQuery
    deleteQuery[kSecUseAuthenticationUI] = kSecUseAuthenticationUIFail
    let status = SecItemDelete(deleteQuery as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
        fail("Unable to delete Keychain item", status: status)
    }

default:
    fail("Usage: chatgpt-system-keychain-helper <store|read|delete> <account> <service>")
}
