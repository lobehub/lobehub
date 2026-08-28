import { normalizeAudioDurationMs } from '../audio';

const AUDIO_METADATA_TIMEOUT_MS = 5000;

/**
 * Reads a local audio file's intrinsic duration from browser media metadata.
 *
 * The caller is responsible for classifying the file as audio. Unsupported or malformed media,
 * missing browser APIs, non-finite durations, and metadata timeouts all fall back to `undefined` so
 * duration discovery never blocks the upload indefinitely.
 */
export const getAudioDuration = async (file: File): Promise<number | undefined> => {
  if (
    typeof Audio === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return undefined;
  }

  let audio: HTMLAudioElement;
  let objectUrl: string;

  try {
    audio = new Audio();
    objectUrl = URL.createObjectURL(file);
  } catch {
    return undefined;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);

      audio.removeEventListener('durationchange', handleDuration);
      audio.removeEventListener('error', handleError);
      audio.removeEventListener('loadedmetadata', handleDuration);
      audio.removeAttribute('src');
      if (typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(objectUrl);
    };

    const settle = (durationMs: number | undefined) => {
      if (settled) return;

      settled = true;
      try {
        cleanup();
      } catch {
        // Cleanup is best-effort; browser URL/media cleanup failures must not leave callers pending.
      }
      resolve(durationMs);
    };

    const handleDuration = () => {
      const durationMs = normalizeAudioDurationMs(audio.duration * 1000);
      if (durationMs !== undefined) settle(durationMs);
    };

    const handleError = () => settle(undefined);

    try {
      audio.preload = 'metadata';
      audio.addEventListener('durationchange', handleDuration);
      audio.addEventListener('error', handleError);
      audio.addEventListener('loadedmetadata', handleDuration);
      timeoutId = setTimeout(() => settle(undefined), AUDIO_METADATA_TIMEOUT_MS);
      audio.src = objectUrl;
      audio.load();
    } catch {
      settle(undefined);
    }
  });
};
