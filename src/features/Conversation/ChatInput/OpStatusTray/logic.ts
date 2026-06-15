export const parseStatusPhrases = (raw: unknown): string[] => {
  if (Array.isArray(raw)) {
    return raw
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  if (typeof raw !== 'string') return [];

  return raw
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean);
};

const hashString = (input: string): number => {
  let hash = 0x81_1c_9d_c5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash;
};

export const pickStableStatusPhrase = (phrases: string[], seed: string): string | undefined => {
  if (phrases.length === 0) return undefined;
  return phrases[hashString(seed) % phrases.length];
};

/**
 * Cycle through phrases over time so the status text reads like a carousel.
 * `step` advances once per rotation tick; the seed keeps the starting phrase
 * stable per operation so two concurrent operations don't sync up.
 */
export const pickRotatingStatusPhrase = (
  phrases: string[],
  seed: string,
  step: number,
): string | undefined => {
  if (phrases.length === 0) return undefined;
  const start = hashString(seed) % phrases.length;
  const safeStep = Number.isFinite(step) ? Math.max(0, Math.floor(step)) : 0;
  return phrases[(start + safeStep) % phrases.length];
};
