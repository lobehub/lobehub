import {
  elevenlabsExpressiveTTSSchema,
  elevenlabsTTSSchema,
  elevenlabsTTSVoices,
} from '../const/ttsParameters';
import type { AITTSModelCard } from '../types/aiModel';

// API list prices: $0.08 (v4 / v3 / Multilingual v2) and $0.04 (Flash / Turbo) per 1k characters.
// `eleven_v4_turbo` is left out: ElevenLabs only serves it over the Text to Dialogue websocket,
// not the Create speech endpoint.
// @see https://elevenlabs.io/pricing/api
// @see https://elevenlabs.io/docs/overview/models
const elevenlabsTTSModels: AITTSModelCard[] = [
  {
    description:
      'ElevenLabs’ most expressive, highest-quality speech model, with audio tags, high-fidelity voice cloning and 90+ languages. Up to 10,000 characters per request.',
    displayName: 'Eleven v4',
    enabled: true,
    id: 'eleven_v4',
    isOfficial: true,
    parameters: elevenlabsExpressiveTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 80, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
  {
    description:
      'Lifelike speech with rich emotional expression across 29 languages. Up to 10,000 characters per request.',
    displayName: 'Eleven Multilingual v2',
    enabled: true,
    id: 'eleven_multilingual_v2',
    isOfficial: true,
    parameters: elevenlabsTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 80, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
  {
    description:
      'Ultra-low-latency (~100 ms) speech model for real-time use across 32 languages, at half the price of the quality models. Up to 40,000 characters per request.',
    displayName: 'Eleven Flash v2.5',
    enabled: true,
    id: 'eleven_flash_v2_5',
    isOfficial: true,
    parameters: elevenlabsTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
  {
    description:
      'Previous-generation expressive speech model with audio tags and 70+ languages. Up to 5,000 characters per request.',
    displayName: 'Eleven v3',
    id: 'eleven_v3',
    isOfficial: true,
    parameters: elevenlabsExpressiveTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 80, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
  {
    description:
      'English-only ultra-low-latency (~135 ms) speech model for real-time use. Up to 30,000 characters per request.',
    displayName: 'Eleven Flash v2',
    id: 'eleven_flash_v2',
    isOfficial: true,
    parameters: elevenlabsTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
  {
    description:
      'Low-latency speech model across 32 languages. ElevenLabs has deprecated it in favor of Eleven Flash v2.5, which matches it at lower latency.',
    displayName: 'Eleven Turbo v2.5',
    id: 'eleven_turbo_v2_5',
    isOfficial: true,
    legacy: true,
    parameters: elevenlabsTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: elevenlabsTTSVoices,
  },
];

export const allModels = [...elevenlabsTTSModels];

export default allModels;
