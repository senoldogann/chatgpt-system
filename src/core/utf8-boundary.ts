// Bayt tabanlı log imleçleri çok baytlı bir UTF-8 karakterin ortasına
// düşebilir. Bu yardımcı yalnızca tam karakterlerden oluşan aralığı verir:
// baştaki devam baytları (budanmış tampon başlangıcı) atlanır, sondaki eksik
// dizi bir sonraki okumaya bırakılır.

function sequenceLength(lead: number): number {
  if (lead < 0x80) return 1;
  if ((lead & 0xe0) === 0xc0) return 2;
  if ((lead & 0xf0) === 0xe0) return 3;
  if ((lead & 0xf8) === 0xf0) return 4;
  return 1;
}

function isContinuation(byte: number): boolean {
  return (byte & 0xc0) === 0x80;
}

export function completeUtf8Span(bytes: Uint8Array): { start: number; end: number } {
  let start = 0;
  while (start < bytes.length && start < 3 && isContinuation(bytes[start]!)) start += 1;

  let end = bytes.length;
  for (let index = bytes.length - 1; index >= Math.max(start, bytes.length - 4); index -= 1) {
    const byte = bytes[index]!;
    if (isContinuation(byte)) continue;
    if (index + sequenceLength(byte) > bytes.length) end = index;
    break;
  }
  return { start, end };
}
