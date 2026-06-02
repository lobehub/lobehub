import { type AIChatModelCard, type AIImageModelCard } from '../types/aiModel';

const minimaxChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 524_288,
    description:
      'Latest flagship model with 512K context, 128K max output, and image input support.',
    displayName: 'MiniMax M3',
    enabled: true,
    id: 'MiniMax-M3',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.84, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'First self-evolving model with top-tier coding and agentic performance (~60 tps).',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description: 'Same performance as M2.7 with significantly faster inference (~100 tps).',
    displayName: 'MiniMax M2.7 Highspeed',
    id: 'MiniMax-M2.7-highspeed',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
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
      imageUrls: { default: [] },
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
        enum: ['1:1', '16:9', '4:3', '3:2', '2:3', '3:4', '9:16'],
      },
      imageUrls: { default: [] },
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
