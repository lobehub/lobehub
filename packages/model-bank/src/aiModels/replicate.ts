import type { AIImageModelCard, AIVideoModelCard } from '../types';

// Replicate image models
// https://replicate.com/black-forest-labs
const imageModels: AIImageModelCard[] = [
  {
    description:
      'FLUX 1.1 Pro is a faster, improved FLUX Pro with excellent image quality and prompt adherence.',
    displayName: 'FLUX 1.1 Pro',
    enabled: true,
    id: 'black-forest-labs/flux-1.1-pro',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
      },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-10-02',
    type: 'image',
  },
  {
    description: 'FLUX Schnell is a fast image generation model optimized for speed.',
    displayName: 'FLUX Schnell',
    enabled: true,
    id: 'black-forest-labs/flux-schnell',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
      },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.003, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
  {
    description: 'FLUX Dev is the development version of FLUX for non-commercial use.',
    displayName: 'FLUX Dev',
    enabled: true,
    id: 'black-forest-labs/flux-dev',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
      },
      cfg: { default: 3.5, max: 10, min: 1, step: 0.1 },
      prompt: { default: '' },
      seed: { default: null },
      steps: { default: 28, max: 50, min: 1 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
  {
    description: 'FLUX Pro is the professional FLUX model for high-quality image output.',
    displayName: 'FLUX Pro',
    enabled: true,
    id: 'black-forest-labs/flux-pro',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '21:9', '9:21'],
      },
      cfg: { default: 3, max: 10, min: 1, step: 0.1 },
      prompt: { default: '' },
      seed: { default: null },
      steps: { default: 25, max: 50, min: 1 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
];

// Replicate video models
// https://replicate.com/prunaai/p-video
const videoModels: AIVideoModelCard[] = [
  {
    description:
      'Fast video generation with text-to-video and image-to-video in a single endpoint, tuned for rapid creative iteration.',
    displayName: 'P-Video',
    enabled: true,
    id: 'prunaai/p-video',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '1:1'],
      },
      duration: { default: 5, max: 20, min: 1, step: 1 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [
        {
          lookup: {
            pricingParams: ['resolution'],
            prices: { '1080p': 0.04, '720p': 0.02 },
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'second',
        },
      ],
    },
    releasedAt: '2026-08-06',
    type: 'video',
  },
];

export const allModels = [...imageModels, ...videoModels];

export default allModels;
