import { doubaoSpeech20Voices, doubaoSpeechTTSSchema } from '../const/ttsParameters';
import type { AITTSModelCard } from '../types/aiModel';

// Pay-as-you-go price of Doubao Speech Synthesis 2.0: 3 CNY per 10,000 characters, every
// character (Han, letter, punctuation, space) counting as one. The model id is the V3
// `X-Api-Resource-Id`; 1.0 voices need another resource and are not offered.
// @see https://www.volcengine.com/docs/6561/1359370
const doubaoSpeechTTSModels: AITTSModelCard[] = [
  {
    description:
      'Doubao Speech Synthesis 2.0 (Seed-TTS 2.0): natural, expressive Mandarin and English speech with official 2.0 voices.',
    displayName: 'Doubao Speech 2.0',
    enabled: true,
    id: 'seed-tts-2.0',
    isOfficial: true,
    parameters: doubaoSpeechTTSSchema,
    pricing: {
      currency: 'CNY',
      units: [{ name: 'textInput', rate: 300, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
    voices: doubaoSpeech20Voices,
  },
];

export const allModels = [...doubaoSpeechTTSModels];

export default allModels;
