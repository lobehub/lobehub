import type { MusicModelParamsSchema } from '../standard-parameters/music';

// ---------------------------------------------------------------------------
// MiniMax Music
// @see https://platform.minimax.io/docs/api-reference/music-generation
// ---------------------------------------------------------------------------

const minimaxAudioSettings = {
  bitrate: { default: 256_000, enum: [32_000, 64_000, 128_000, 256_000] },
  format: { default: 'mp3', enum: ['mp3', 'wav', 'pcm'] },
  sampleRate: { default: 44_100, enum: [16_000, 24_000, 32_000, 44_100] },
} satisfies Partial<MusicModelParamsSchema>;

/**
 * `music-3.0` / `music-2.6`: text to song. Lyrics are required for vocal tracks unless
 * `lyrics_optimizer` writes them from the prompt; `is_instrumental` drops the vocals.
 */
export const minimaxMusicSchema = {
  ...minimaxAudioSettings,
  autoLyrics: { default: false },
  instrumental: { default: false },
  lyrics: { default: null, maxLength: 3500 },
  prompt: { default: '', maxLength: 2000 },
} satisfies MusicModelParamsSchema;

/**
 * `music-cover`: covers a reference track (6 s – 6 min, ≤ 50 MB) in the style the prompt
 * describes. Lyrics are optional: MiniMax transcribes them from the reference when omitted.
 */
export const minimaxMusicCoverSchema = {
  ...minimaxAudioSettings,
  lyrics: { default: null, maxLength: 1000, minLength: 10 },
  prompt: { default: '', maxLength: 300, minLength: 10 },
  referenceAudioUrl: {
    default: null,
    maxDuration: 360,
    maxFileSize: 50 * 1024 * 1024,
    minDuration: 6,
    required: true,
  },
} satisfies MusicModelParamsSchema;

// ---------------------------------------------------------------------------
// Suno (through a sunoapi.org-compatible Suno API gateway)
// @see https://docs.sunoapi.org/suno-api/generate-music
// ---------------------------------------------------------------------------

/**
 * Suno V6 family. Filling `lyrics`, `title` or `style` switches the request to custom mode;
 * otherwise Suno writes the song (and its lyrics) from `prompt` alone.
 */
export const sunoV6MusicSchema = {
  duration: { default: null, max: 360, min: 10, step: 1 },
  instrumental: { default: false },
  lyrics: { default: null, maxLength: 5000 },
  negativeStyle: { default: null },
  prompt: { default: '', maxLength: 3000 },
  style: { default: null, maxLength: 1000 },
  title: { default: null, maxLength: 80 },
} satisfies MusicModelParamsSchema;
