import ComputerRuntimeHostCore
import Darwin
import Foundation

@main
struct ComputerRuntimeHost {
    static func main() async {
        let server = NDJSONHostServer(service: ComputerHostService.system())
        do {
            try await server.run()
        } catch {
            FileHandle.standardError.write(Data("computer runtime host stopped\n".utf8))
            exit(1)
        }
    }
}
