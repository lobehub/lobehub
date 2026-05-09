export interface SplitOptions {
  /** Random jitter, e.g. 0.15 means each chunk size varies ±15%. Default 0 (deterministic). */
  jitter?: number;
  targetChunkChars: number;
}

export function splitTextIntoChunks(text: string, opts: SplitOptions): string[] {
  if (!text) return [];
  const codePoints = [...text]; // splits by code point, not UTF-16 unit
  if (codePoints.length <= opts.targetChunkChars) return [text];

  const { targetChunkChars, jitter = 0 } = opts;
  const minSize = jitter > 0 ? Math.floor(targetChunkChars * (1 - jitter)) : 1;
  const maxSize = jitter > 0 ? Math.ceil(targetChunkChars * (1 + jitter)) : targetChunkChars;
  const total = codePoints.length;

  // Decide chunk count up-front so every chunk can satisfy [minSize, maxSize].
  // Prefer the count that puts the average closest to targetChunkChars.
  const minCount = Math.max(1, Math.ceil(total / maxSize));
  const maxCount = Math.max(minCount, Math.floor(total / minSize));
  const idealCount = Math.max(1, Math.round(total / targetChunkChars));
  const count = Math.min(maxCount, Math.max(minCount, idealCount));

  // Generate `count` jittered sizes that sum to `total` and each lies within [minSize, maxSize].
  const sizes: number[] = [];
  let remaining = total;
  for (let k = 0; k < count; k++) {
    const slotsLeft = count - k;
    if (slotsLeft === 1) {
      sizes.push(remaining);
      break;
    }
    const variance = jitter > 0 ? (Math.random() * 2 - 1) * jitter : 0;
    let size = Math.max(1, Math.round(targetChunkChars * (1 + variance)));
    // Bound so the remaining slots can still each receive a value in [minSize, maxSize].
    const maxAllowed = Math.min(maxSize, remaining - (slotsLeft - 1) * minSize);
    const minAllowed = Math.max(minSize, remaining - (slotsLeft - 1) * maxSize);
    if (size > maxAllowed) size = maxAllowed;
    if (size < minAllowed) size = minAllowed;
    sizes.push(size);
    remaining -= size;
  }

  const result: string[] = [];
  let i = 0;
  for (const size of sizes) {
    result.push(codePoints.slice(i, i + size).join(''));
    i += size;
  }
  return result;
}
