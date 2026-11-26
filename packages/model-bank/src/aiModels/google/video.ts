import type { AIVideoModelCard } from '../../types';

/** Veo video generation through the Gemini API. */
export const googleVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Our latest video generation model, available to developers on the paid tier of the Gemini API.',
    displayName: 'Veo 3.1 Generate Preview',
    enabled: true,
    id: 'veo-3.1-generate-preview',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16'],
      },
      duration: { default: 8, enum: [4, 6, 8] },
      endImageUrl: {
        default: null,
      },
      imageUrls: {
        default: [],
        maxCount: 3,
      },
      prompt: { default: '' },
      resolution: {
        default: '720p',
        enum: ['720p', '1080p', '4k'],
      },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.6, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-01-13',
    type: 'video',
  },
  {
    description:
      'Our latest video generation model, available to developers on the paid tier of the Gemini API.',
    displayName: 'Veo 3.1 Fast Generate Preview',
    enabled: true,
    id: 'veo-3.1-fast-generate-preview',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16'],
      },
      duration: { default: 8, enum: [4, 6, 8] },
      endImageUrl: {
        default: null,
      },
      imageUrls: {
        default: [],
        maxCount: 3,
      },
      prompt: { default: '' },
      resolution: {
        default: '720p',
        enum: ['720p', '1080p', '4k'],
      },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.35, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-01-13',
    type: 'video',
  },
  {
    description:
      "Google's video generation and editing model with native audio: text, image and reference-guided video, first/last frame interpolation, and conversational editing.",
    displayName: 'Gemini Omni 1.1 Flash',
    enabled: true,
    id: 'gemini-omni-1.1-flash',
    isOfficial: true,
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16'],
      },
      duration: { default: 8, max: 10, min: 3, step: 1 },
      endImageUrl: {
        default: null,
      },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      resolution: {
        default: '720p',
        enum: ['360p', '720p', '1080p', '4k'],
      },
    },
    pricing: {
      // Billed per token: video output is about 5,792 tokens per second of 720p video (~$0.10/s).
      // https://ai.google.dev/gemini-api/docs/pricing
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'videoInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'videoGeneration', rate: 17.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-27',
    type: 'video',
  },
];
