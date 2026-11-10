/** `m:ss`, or `h:mm:ss` from one hour on. */
export const formatOffset = (ms: number) => {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${minutes}:${seconds}`;
};

/** Number in a diarization label (`S2` → 2), or `undefined` for a free-form label. */
export const speakerIndex = (label?: string | null) => {
  const match = label?.match(/^S(\d+)$/);
  return match ? Number(match[1]) : undefined;
};
