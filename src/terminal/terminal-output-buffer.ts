export interface TerminalOutputRead {
  data: string;
  bytes: number;
  nextSequence: number;
  truncatedBefore: boolean;
}

interface TerminalOutputChunk {
  sequence: number;
  data: string;
  bytes: number;
  prefixTruncated: boolean;
}

function utf8Tail(value: string, maxBytes: number): { data: string; bytes: number; truncated: boolean } {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maxBytes) {
    return { data: value, bytes: encoded.byteLength, truncated: false };
  }

  let start = encoded.byteLength - maxBytes;
  while (start < encoded.byteLength && (encoded[start]! & 0xc0) === 0x80) start += 1;
  const tail = encoded.subarray(start);
  return {
    data: tail.toString("utf8"),
    bytes: tail.byteLength,
    truncated: true,
  };
}

export class TerminalOutputBuffer {
  private readonly chunks: TerminalOutputChunk[] = [];
  private sequenceValue = 0;
  private retainedBytesValue = 0;

  constructor(private readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("Terminal output byte limit must be a positive integer.");
    }
  }

  get sequence(): number {
    return this.sequenceValue;
  }

  get retainedBytes(): number {
    return this.retainedBytesValue;
  }

  append(data: string): number {
    if (data.length === 0) return this.sequenceValue;

    const sequence = ++this.sequenceValue;
    const tail = utf8Tail(data, this.maxBytes);
    if (tail.truncated) {
      this.chunks.length = 0;
      this.retainedBytesValue = 0;
    }

    this.chunks.push({
      sequence,
      data: tail.data,
      bytes: tail.bytes,
      prefixTruncated: tail.truncated,
    });
    this.retainedBytesValue += tail.bytes;

    while (this.retainedBytesValue > this.maxBytes && this.chunks.length > 1) {
      const removed = this.chunks.shift()!;
      this.retainedBytesValue -= removed.bytes;
    }

    return sequence;
  }

  read(afterSequence = 0): TerminalOutputRead {
    if (!Number.isInteger(afterSequence) || afterSequence < 0) {
      throw new RangeError("Terminal output sequence must be a non-negative integer.");
    }
    if (afterSequence > this.sequenceValue) {
      throw new RangeError("Terminal output sequence is ahead of the current stream.");
    }

    const selected = this.chunks.filter((chunk) => chunk.sequence > afterSequence);
    if (selected.length === 0) {
      return {
        data: "",
        bytes: 0,
        nextSequence: this.sequenceValue,
        truncatedBefore: false,
      };
    }

    const first = selected[0]!;
    const truncatedBefore = afterSequence < first.sequence - 1
      || (first.prefixTruncated && afterSequence < first.sequence);
    const data = selected.map((chunk) => chunk.data).join("");

    return {
      data,
      bytes: Buffer.byteLength(data, "utf8"),
      nextSequence: this.sequenceValue,
      truncatedBefore,
    };
  }
}
