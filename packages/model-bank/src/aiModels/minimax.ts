import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

const minimaxChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Powerful multilingual programming capabilities, comprehensively upgraded programming experience',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'MiniMax-M2.1',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Powerful multilingual programming capabilities, comprehensively upgraded programming experience. Faster and more efficient.',
    displayName: 'MiniMax M2.1 Lightning',
    id: 'MiniMax-M2.1-Lightning',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description: 'Built specifically for efficient coding and Agent workflows',
    displayName: 'MiniMax M2',
    id: 'MiniMax-M2',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-27',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Built for efficient coding and agent workflows, with higher concurrency for commercial use.',
    displayName: 'MiniMax M2 Stable',
    id: 'MiniMax-M2-Stable',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-27',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_192,
    description:
      'A new in-house reasoning model with 80K chain-of-thought and 1M input, delivering performance comparable to top global models.',
    displayName: 'MiniMax M1',
    id: 'MiniMax-M1',
    maxOutput: 40_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-16',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_000_192,
    description:
      'MiniMax-01 introduces large-scale linear attention beyond classic Transformers, with 456B parameters and 45.9B activated per pass. It achieves top-tier performance and supports up to 4M tokens of context (32× GPT-4o, 20× Claude-3.5-Sonnet).',
    displayName: 'MiniMax Text 01',
    id: 'MiniMax-Text-01',
    maxOutput: 40_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-15',
    type: 'chat',
  },
];

const minimaxImageModels: AIImageModelCard[] = [
  {
    description:
      'A new image generation model with fine detail, supporting text-to-image and image-to-image.',
    displayName: 'Image 01',
    enabled: true,
    id: 'image-01',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    releasedAt: '2025-02-28',
    type: 'image',
  },
  {
    description:
      'An image generation model with fine detail, supporting text-to-image and controllable style presets.',
    displayName: 'Image 01 Live',
    enabled: true,
    id: 'image-01-live',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16', '21:9'],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    releasedAt: '2025-02-28',
    type: 'image',
  },
];

export const allModels = [...minimaxChatModels, ...minimaxImageModels];

export default allModels;
