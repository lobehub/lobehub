import { googleTTSSchema, googleTTSVoices } from '../../const/ttsParameters';
import type { AITTSModelCard } from '../../types';

/**
 * Gemini TTS through `generateContent`. Billed per token: text input and audio output
 * (about 25 audio tokens per second of speech). Google halves the 3.8 TTS rates through
 * 2026-12-31; `originalRate` keeps the list price from 2027-01-01.
 * Gemini 2.5 preview TTS is listed as legacy: Google shuts it down on 2026-11-17 at the
 * earliest and recommends the 3.8 models instead.
 * @see https://ai.google.dev/gemini-api/docs/pricing
 * @see https://ai.google.dev/gemini-api/docs/deprecations
 */
export const googleTTSModels: AITTSModelCard[] = [
  {
    description:
      'Gemini 3.8 Flash TTS turns text into natural, controllable speech with 30 prebuilt voices; style, pace and tone follow natural-language instructions.',
    displayName: 'Gemini 3.8 Flash TTS',
    enabled: true,
    id: 'gemini-3.8-flash-tts',
    parameters: googleTTSSchema,
    pricing: {
      units: [
        { name: 'textInput', originalRate: 1, rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'audioOutput',
          originalRate: 18,
          rate: 9,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'tts',
    voices: googleTTSVoices,
  },
  {
    description:
      'Gemini 3.8 Flash-Lite TTS is the low-cost, low-latency Gemini speech model with the same 30 prebuilt voices and instruction-driven style control.',
    displayName: 'Gemini 3.8 Flash-Lite TTS',
    enabled: true,
    id: 'gemini-3.8-flash-lite-tts',
    parameters: googleTTSSchema,
    pricing: {
      units: [
        { name: 'textInput', originalRate: 1, rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'audioOutput',
          originalRate: 12,
          rate: 6,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'tts',
    voices: googleTTSVoices,
  },
  {
    description:
      'Gemini 2.5 Flash Preview TTS is the earlier low-latency Gemini speech model. Google shuts it down on 2026-11-17; use Gemini 3.8 Flash TTS instead.',
    displayName: 'Gemini 2.5 Flash Preview TTS',
    id: 'gemini-2.5-flash-preview-tts',
    legacy: true,
    parameters: googleTTSSchema,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'tts',
    voices: googleTTSVoices,
  },
  {
    description:
      'Gemini 2.5 Pro Preview TTS is the earlier high-quality Gemini speech model. Google shuts it down on 2026-11-17; use Gemini 3.8 Flash TTS instead.',
    displayName: 'Gemini 2.5 Pro Preview TTS',
    id: 'gemini-2.5-pro-preview-tts',
    legacy: true,
    parameters: googleTTSSchema,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'tts',
    voices: googleTTSVoices,
  },
];
