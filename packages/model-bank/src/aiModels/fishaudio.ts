import {
  fishAudioDirectedTTSSchema,
  fishAudioTTSSchema,
  fishAudioTTSVoices,
} from '../const/ttsParameters';
import type { AITTSModelCard } from '../types/aiModel';

// API list prices per million UTF-8 bytes: $15 for S2.1 Pro, S2 Pro and S1, $50 for Drama 3
// (launch promotion $10 until 2026-12-01). The runtime reports the UTF-8 byte count as
// `inputCharacters`, so `millionCharacters` here bills exactly what Fish Audio bills.
// `s2.1-pro-free` is left out: it is free only for a limited time.
// @see https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits
// @see https://docs.fish.audio/developer-guide/models-pricing/models-overview
const fishAudioTTSModels: AITTSModelCard[] = [
  {
    description:
      'Fish Audio’s recommended production speech model: 80+ languages, natural-language [directions] for delivery, multi-speaker and voice cloning.',
    displayName: 'Fish Audio S2.1 Pro',
    enabled: true,
    id: 's2.1-pro',
    isOfficial: true,
    parameters: fishAudioDirectedTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: fishAudioTTSVoices,
  },
  {
    description:
      'Fish Audio’s most expressive model: direct each line in natural language, with sound effects, pauses and per-word tags.',
    displayName: 'Fish Audio Drama 3',
    enabled: true,
    id: 'drama-3',
    isOfficial: true,
    parameters: fishAudioDirectedTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 50, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: fishAudioTTSVoices,
  },
  {
    description:
      'Previous-generation open-weights speech model with 80+ languages and [bracketed] delivery directions.',
    displayName: 'Fish Audio S2 Pro',
    id: 's2-pro',
    isOfficial: true,
    parameters: fishAudioDirectedTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: fishAudioTTSVoices,
  },
  {
    description:
      'Deprecated speech model with 13 languages and (parenthesis) emotion tags. Fish Audio retires it on 2026-12-31 and then serves requests with S2.1 Pro.',
    displayName: 'Fish Audio S1',
    id: 's1',
    isOfficial: true,
    legacy: true,
    parameters: fishAudioTTSSchema,
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: fishAudioTTSVoices,
  },
];

export const allModels = [...fishAudioTTSModels];

export default allModels;
