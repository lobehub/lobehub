import type { AIASRModelCard } from '../types/aiModel';

const funasrASRModels: AIASRModelCard[] = [
  {
    description:
      'A multilingual speech recognition model with language, emotion, and audio-event detection for Chinese, Cantonese, English, Japanese, and Korean.',
    displayName: 'SenseVoice Small',
    enabled: true,
    id: 'sensevoice',
    type: 'asr',
  },
  {
    description:
      'A production-oriented non-autoregressive speech recognition model for Mandarin with punctuation and timestamp support.',
    displayName: 'Paraformer',
    id: 'paraformer',
    type: 'asr',
  },
  {
    description: 'The English speech recognition route provided by the FunASR API server.',
    displayName: 'Paraformer English',
    id: 'paraformer-en',
    type: 'asr',
  },
  {
    description:
      'An LLM-based speech recognition model for Chinese, English, Japanese, and Chinese dialects and regional accents.',
    displayName: 'Fun-ASR-Nano',
    id: 'fun-asr-nano',
    type: 'asr',
  },
];

export default funasrASRModels;
