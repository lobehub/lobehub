import { gptImage1Schema, gptImage2Schema } from '../../const/imageParameters';
import type {
  AIASRModelCard,
  AIEmbeddingModelCard,
  AIImageModelCard,
  AIRealtimeModelCard,
  AITTSModelCard,
  AIVideoModelCard,
} from '../../types/aiModel';

/** OpenAI cards for endpoints other than chat and decisions; `allModels` lives in `./index`. */

export const openaiEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 8192,
    description: 'The most capable embedding model for English and non-English tasks.',
    displayName: 'Text Embedding 3 Large',
    id: 'text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
  {
    contextWindowTokens: 8192,
    description:
      'An efficient, cost-effective next-generation embedding model for retrieval and RAG scenarios.',
    displayName: 'Text Embedding 3 Small',
    id: 'text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2024-01-25',
    type: 'embedding',
  },
];

// Text-to-speech models
export const openaiTTSModels: AITTSModelCard[] = [
  {
    description: 'The latest text-to-speech model optimized for real-time speed.',
    displayName: 'TTS-1',
    id: 'tts-1',
    pricing: {
      units: [{ name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description: 'The latest text-to-speech model optimized for quality.',
    displayName: 'TTS-1 HD',
    id: 'tts-1-hd',
    pricing: {
      units: [{ name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionCharacters' }],
    },
    type: 'tts',
  },
  {
    description:
      'GPT-4o mini TTS is a text-to-speech model built on GPT-4o mini, converting text into natural-sounding speech with a max input of 2000 tokens.',
    displayName: 'GPT-4o Mini TTS',
    id: 'gpt-4o-mini-tts',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'tts',
  },
];

// Speech recognition models
export const openaiASRModels: AIASRModelCard[] = [
  {
    description:
      'A general speech recognition model supporting multilingual ASR, speech translation, and language identification.',
    displayName: 'Whisper',
    enabled: true,
    id: 'whisper-1',
    pricing: {
      units: [
        {
          name: 'audioInput',
          rate: 0.0001, // $0.006 per minute => $0.0001 per second
          strategy: 'fixed',
          unit: 'second',
        },
      ],
    },
    type: 'asr',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'GPT-4o Transcribe is a speech-to-text model that transcribes audio with GPT-4o, improving word error rate, language ID, and accuracy over the original Whisper model.',
    displayName: 'GPT-4o Transcribe',
    id: 'gpt-4o-transcribe',
    maxOutput: 2000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'asr',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'GPT-4o Mini Transcribe is a speech-to-text model that transcribes audio with GPT-4o, improving word error rate, language ID, and accuracy over the original Whisper model.',
    displayName: 'GPT-4o Mini Transcribe',
    enabled: true,
    id: 'gpt-4o-mini-transcribe',
    maxOutput: 2000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'asr',
  },
];

// Image generation models
export const openaiImageModels: AIImageModelCard[] = [
  {
    description:
      "OpenAI's next-generation multimodal image model with native reasoning, up to 4K resolution, near-perfect text rendering, and high-fidelity multilingual support.",
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    parameters: gptImage2Schema,
    pricing: {
      // Medium quality at 1024x1024: ~1767 output tokens * $30/M = $0.053 per image.
      // Source: https://developers.openai.com/api/docs/guides/image-generation#calculating-costs
      approximatePricePerImage: 0.053,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    type: 'image',
  },
  {
    description:
      'An enhanced GPT Image 1 model with 4× faster generation, more precise editing, and improved text rendering.',
    displayName: 'GPT Image 1.5',
    id: 'gpt-image-1.5',
    parameters: gptImage1Schema,
    pricing: {
      approximatePricePerImage: 0.034,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-16',
    type: 'image',
  },
  // https://platform.openai.com/docs/models/gpt-image-1
  {
    description: 'ChatGPT native multimodal image generation model.',
    displayName: 'GPT Image 1',
    id: 'gpt-image-1',
    parameters: gptImage1Schema,
    pricing: {
      approximatePricePerImage: 0.042,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'image',
  },
  {
    description:
      'A lower-cost GPT Image 1 variant with native text and image input and image output.',
    displayName: 'GPT Image 1 Mini',
    id: 'gpt-image-1-mini',
    parameters: gptImage1Schema,
    pricing: {
      approximatePricePerImage: 0.011,
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-06',
    type: 'image',
  },
];

// GPT-4o and GPT-4o-mini realtime models
export const openaiRealtimeModels: AIRealtimeModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A general real-time model supporting real-time text and audio I/O, plus image input.',
    displayName: 'GPT Realtime',
    id: 'gpt-realtime',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 64, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },

        { name: 'imageInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'realtime',
  },
  {
    contextWindowTokens: 16_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 241217',
    id: 'gpt-4o-realtime-preview',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    type: 'realtime',
  },
  {
    contextWindowTokens: 32_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 250603',
    id: 'gpt-4o-realtime-preview-2025-06-03',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 80, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-03',
    type: 'realtime',
  },
  {
    contextWindowTokens: 16_000,
    description: 'GPT-4o realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Realtime 241001',
    id: 'gpt-4o-realtime-preview-2024-10-01', // deprecated on 2025-10-10
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 200, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-01',
    type: 'realtime',
  },
  {
    contextWindowTokens: 128_000,
    description: 'GPT-4o-mini realtime variant with audio and text real-time I/O.',
    displayName: 'GPT-4o Mini Realtime',
    id: 'gpt-4o-mini-realtime-preview',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'audioInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    type: 'realtime',
  },
];

export const openaiVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Sora 2 is our new powerful media generation model, generating videos with synced audio. It can create richly detailed, dynamic clips from natural language or images.',
    displayName: 'Sora 2',
    enabled: true,
    id: 'sora-2',
    parameters: {
      duration: { default: 4, enum: [4, 8, 12] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '720x1280',
        enum: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
      },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-08',
    type: 'video',
  },
  {
    description:
      'Sora 2 Pro is our state-of-the-art, most advanced media generation model, generating videos with synced audio. It can create richly detailed, dynamic clips from natural language or images.',
    displayName: 'Sora 2 Pro',
    enabled: true,
    id: 'sora-2-pro',
    parameters: {
      duration: { default: 4, enum: [4, 8, 12] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '720x1280',
        enum: ['720x1280', '1280x720', '1024x1792', '1792x1024'],
      },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-10-06',
    type: 'video',
  },
];
