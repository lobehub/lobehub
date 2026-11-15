const pad = (value: number) => String(value).padStart(2, '0');

/** `mm:ss`, or `h:mm:ss` from one hour on — the clock of a recording or a timestamp. */
export const formatClock = (ms: number): string => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
};

/** Index of the segment playing at `ms` (segments sorted by start), or -1. */
export const findActiveSegment = (
  segments: readonly { endMs: number; startMs: number }[],
  ms: number,
): number => {
  let low = 0;
  let high = segments.length - 1;
  let candidate = -1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    if (segments[mid].startMs <= ms) {
      candidate = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Between two utterances nothing is highlighted.
  return candidate !== -1 && ms < segments[candidate].endMs ? candidate : -1;
};
