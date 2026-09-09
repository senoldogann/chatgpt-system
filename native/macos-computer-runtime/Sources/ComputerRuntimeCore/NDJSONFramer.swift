import Foundation

public enum NDJSONFramingError: Error, Equatable {
    case lineTooLarge
    case emptyLine
    case incompleteFrame
}

public struct NDJSONFramer: Sendable {
    private var buffer = Data()
    private let maxLineBytes: Int

    public init(maxLineBytes: Int) {
        precondition(maxLineBytes > 0)
        self.maxLineBytes = maxLineBytes
    }

    public mutating func append(_ data: Data) throws -> [Data] {
        buffer.append(data)
        var frames: [Data] = []

        while let newline = buffer.firstIndex(of: 0x0A) {
            var line = Data(buffer[..<newline])
            buffer.removeSubrange(...newline)
            if line.last == 0x0D {
                line.removeLast()
            }
            guard !line.isEmpty else {
                throw NDJSONFramingError.emptyLine
            }
            guard line.count <= maxLineBytes else {
                throw NDJSONFramingError.lineTooLarge
            }
            frames.append(line)
        }

        guard buffer.count <= maxLineBytes else {
            throw NDJSONFramingError.lineTooLarge
        }
        return frames
    }

    public mutating func finish() throws {
        guard buffer.isEmpty else {
            throw NDJSONFramingError.incompleteFrame
        }
    }
}
