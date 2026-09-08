import Foundation
import LocalAuthentication

enum Profile: String, Codable {
    case user
    case admin
}

enum Outcome: String, Codable {
    case authenticated
    case denied
    case cancelled
    case unavailable
    case failed
}

struct Arguments {
    let profile: Profile
    let requestId: String
}

struct ResultPayload: Codable {
    let requestId: String
    let profile: Profile
    let approved: Bool
    let outcome: Outcome
}

func parseArguments(_ values: [String]) -> Arguments? {
    var profile: Profile?
    var requestId: String?
    var index = 0

    while index < values.count {
        let flag = values[index]
        guard index + 1 < values.count else { return nil }
        let value = values[index + 1]

        switch flag {
        case "--profile":
            guard profile == nil, let parsed = Profile(rawValue: value) else { return nil }
            profile = parsed
        case "--request-id":
            guard requestId == nil else { return nil }
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, trimmed.count <= 256 else { return nil }
            requestId = trimmed
        default:
            return nil
        }
        index += 2
    }

    guard let profile, let requestId else { return nil }
    return Arguments(profile: profile, requestId: requestId)
}

func fixedReason(for profile: Profile) -> String {
    switch profile {
    case .user:
        return "Approve User Full Access for this ChatGPT session."
    case .admin:
        return "Approve Machine Admin authority for this ChatGPT session."
    }
}

func mapFailure(_ error: Error?) -> Outcome {
    guard let laError = error as? LAError else { return .failed }
    switch laError.code {
    case .userCancel, .appCancel, .systemCancel:
        return .cancelled
    case .authenticationFailed, .userFallback:
        return .denied
    default:
        return .failed
    }
}

func authenticate(profile: Profile) async -> (approved: Bool, outcome: Outcome) {
    let context = LAContext()
    context.localizedCancelTitle = "Cancel"
    context.localizedFallbackTitle = "Use Password"

    var evaluationError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &evaluationError) else {
        return (false, .unavailable)
    }

    return await withCheckedContinuation { continuation in
        context.evaluatePolicy(
            .deviceOwnerAuthentication,
            localizedReason: fixedReason(for: profile)
        ) { success, error in
            if success {
                continuation.resume(returning: (true, .authenticated))
            } else {
                continuation.resume(returning: (false, mapFailure(error)))
            }
        }
    }
}

func emit(_ payload: ResultPayload) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(payload)
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
}

@main
struct AuthorityBrokerMain {
    static func main() async {
        guard let arguments = parseArguments(Array(CommandLine.arguments.dropFirst())) else {
            FileHandle.standardError.write(Data("invalid arguments\n".utf8))
            exit(2)
        }

        let authentication = await authenticate(profile: arguments.profile)
        let payload = ResultPayload(
            requestId: arguments.requestId,
            profile: arguments.profile,
            approved: authentication.approved,
            outcome: authentication.outcome
        )

        do {
            try emit(payload)
        } catch {
            FileHandle.standardError.write(Data("failed to encode result\n".utf8))
            exit(3)
        }
    }
}
