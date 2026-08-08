/** Public asset played when a funds-blocked user types in the chat composer. */
export const FUNDS_BLOCKED_SOUND_URL = '/audio/pool-vade.mp3';

let audio: HTMLAudioElement | null = null;

const isPlaying = (el: HTMLAudioElement): boolean => !el.paused && !el.ended;

/**
 * Plays the "pool-vade" cue once. Ignores repeat calls while the clip is
 * already playing so keystrokes do not restart the ~12s sample.
 */
export const playFundsBlockedSound = (): void => {
  if (typeof Audio === 'undefined') return;

  try {
    if (!audio) {
      audio = new Audio(FUNDS_BLOCKED_SOUND_URL);
    }

    if (isPlaying(audio)) return;

    audio.currentTime = 0;
    void audio.play().catch(() => {
      // Autoplay policies / missing asset — silent no-op.
    });
  } catch {
    // Ignore Audio construction failures (e.g. non-browser test envs).
  }
};

/** Clears the singleton so unit tests start from a clean slate. */
export const resetFundsBlockedSoundForTests = (): void => {
  if (!audio) return;
  audio.pause();
  audio = null;
};
