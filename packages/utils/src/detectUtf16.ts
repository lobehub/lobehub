const HEURISTIC_SAMPLE_BYTES = 512;
const HEURISTIC_THRESHOLD = 0.3;

/** UTF-16 byte ordering supported by the shared text detector. */
export type Utf16Variant = 'utf-16le' | 'utf-16be';

/**
 * Detect UTF-16 without BOM by sampling and counting ASCII-shaped code-unit
 * pairs. ASCII chars in UTF-16 produce a 0x00 byte at the high half: at
 * odd index for LE, at even index for BE.
 *
 * Used both by `TextLoader` (to pick the right decoder) and by the binary
 * sniffer (so a UTF-16 text file without BOM isn't mistaken for binary
 * because of its alternating null bytes).
 *
 * Use when:
 * - Selecting a decoder for bytes without an encoding marker.
 *
 * Expects:
 * - Raw file bytes; only the first 512 bytes are sampled.
 *
 * Returns:
 * - A likely UTF-16 byte order, or null when the sample is inconclusive.
 */
export const detectUtf16NoBom = (buffer: Uint8Array): Utf16Variant | null => {
  const sample = buffer.subarray(0, Math.min(HEURISTIC_SAMPLE_BYTES, buffer.length));
  if (sample.length < 4 || sample.length % 2 !== 0) return null;

  let leAsciiPairs = 0;
  let beAsciiPairs = 0;
  const totalPairs = sample.length / 2;

  for (let i = 0; i < sample.length; i += 2) {
    const lo = sample[i];
    const hi = sample[i + 1];
    if (hi === 0x00 && lo !== 0x00) leAsciiPairs++;
    else if (lo === 0x00 && hi !== 0x00) beAsciiPairs++;
  }

  if (leAsciiPairs > beAsciiPairs && leAsciiPairs / totalPairs >= HEURISTIC_THRESHOLD) {
    return 'utf-16le';
  }
  if (beAsciiPairs > leAsciiPairs && beAsciiPairs / totalPairs >= HEURISTIC_THRESHOLD) {
    return 'utf-16be';
  }
  return null;
};
