import type { TTSModelParamsSchema, TTSVoice } from '../standard-parameters';
import { TTS_AUDIO_FORMATS } from '../standard-parameters';

/**
 * Built-in OpenAI voices.
 * @see https://platform.openai.com/docs/guides/text-to-speech#voice-options
 */
const OPENAI_TTS_1_VOICES: TTSVoice[] = [
  { displayName: 'Alloy', gender: 'neutral', id: 'alloy', language: 'multilingual' },
  { displayName: 'Ash', gender: 'male', id: 'ash', language: 'multilingual' },
  { displayName: 'Coral', gender: 'female', id: 'coral', language: 'multilingual' },
  { displayName: 'Echo', gender: 'male', id: 'echo', language: 'multilingual' },
  { displayName: 'Fable', gender: 'male', id: 'fable', language: 'multilingual' },
  { displayName: 'Nova', gender: 'female', id: 'nova', language: 'multilingual' },
  { displayName: 'Onyx', gender: 'male', id: 'onyx', language: 'multilingual' },
  { displayName: 'Sage', gender: 'female', id: 'sage', language: 'multilingual' },
  { displayName: 'Shimmer', gender: 'female', id: 'shimmer', language: 'multilingual' },
];

/** `ballad`, `verse`, `marin` and `cedar` are only available on the GPT-4o TTS family. */
export const openaiGpt4oTTSVoices: TTSVoice[] = (
  [
    ...OPENAI_TTS_1_VOICES,
    { displayName: 'Ballad', gender: 'male', id: 'ballad', language: 'multilingual' },
    { displayName: 'Cedar', gender: 'male', id: 'cedar', language: 'multilingual' },
    { displayName: 'Marin', gender: 'female', id: 'marin', language: 'multilingual' },
    { displayName: 'Verse', gender: 'male', id: 'verse', language: 'multilingual' },
  ] satisfies TTSVoice[]
).sort((a, b) => a.id.localeCompare(b.id));

export const openaiTTS1Voices: TTSVoice[] = OPENAI_TTS_1_VOICES;

export const openaiTTS1Schema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: [...TTS_AUDIO_FORMATS] },
  speed: { default: 1, max: 4, min: 0.25, step: 0.05 },
  voice: { default: 'alloy' },
};

/** GPT-4o mini TTS takes style `instructions` but ignores `speed`. */
export const openaiGpt4oMiniTTSSchema: TTSModelParamsSchema = {
  format: { default: 'mp3', enum: [...TTS_AUDIO_FORMATS] },
  instructions: { default: '' },
  voice: { default: 'alloy' },
};
