import {
  type AIChatModelCard,
  type AIImageModelCard,
  type AIVideoModelCard,
} from '../types/aiModel';

const minimaxChatModels: AIChatModelCard[] = [
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
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Top-tier performance and ultimate cost-effectiveness, easily handling complex tasks (approx. 60 tps).',
    displayName: 'MiniMax M2.5',
    id: 'MiniMax-M2.5',
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
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description: 'M2.5 highspeed: Same performance, faster and more agile (approx. 100 tps).',
    displayName: 'MiniMax M2.5 highspeed',
    id: 'MiniMax-M2.5-highspeed',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    contextWindowTokens: 655_36,
    description:
      'A text dialogue model designed for role-playing and multi-turn conversations, with character customization and emotional expression.',
    displayName: 'MiniMax M2-her',
    id: 'M2-her',
    maxOutput: 2048,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'Powerful multilingual programming capabilities, comprehensively upgraded programming experience',
    displayName: 'MiniMax M2.1',
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
    displayName: 'MiniMax M2.1 highspeed',
    id: 'MiniMax-M2.1-highspeed',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' },
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
      imageUrls: { default: [] },
      prompt: {
        default: '',
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
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
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-02-28',
    type: 'image',
  },
];

const minimaxVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Brand-new video generation model with comprehensive upgrades in body motion, physical realism, and instruction following.',
    displayName: 'MiniMax Hailuo 2.3 Fast',
    enabled: true,
    id: 'MiniMax-Hailuo-2.3-Fast',
    parameters: {
      duration: { default: 6, enum: [6, 10] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '768P',
        enum: ['768P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1.35, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-10-28',
    type: 'video',
  },
  {
    description:
      'Brand-new video generation model with comprehensive upgrades in body motion, physical realism, and instruction following.',
    displayName: 'MiniMax Hailuo 2.3',
    enabled: true,
    id: 'MiniMax-Hailuo-2.3',
    parameters: {
      duration: { default: 6, enum: [6, 10] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '768P',
        enum: ['768P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-10-28',
    type: 'video',
  },
  {
    description:
      'The next-generation video generation model, MiniMax Hailuo 02, has been officially released, supporting 1080P resolution and 10-second video generation.',
    displayName: 'MiniMax Hailuo 02',
    enabled: true,
    id: 'MiniMax-Hailuo-02',
    parameters: {
      duration: { default: 6, enum: [6, 10] },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '768P',
        enum: ['512P', '768P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.6, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'A director-level video generation model has been officially released, offering improved adherence to camera movement instructions and cinematic shot storytelling language.',
    displayName: 'I2V 01 Director',
    id: 'I2V-01-Director',
    parameters: {
      duration: { default: 6, enum: [6] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-02-11',
    type: 'video',
  },
  {
    description:
      'A director-level video generation model has been officially released, offering improved adherence to camera movement instructions and cinematic shot storytelling language.',
    displayName: 'T2V 01 Director',
    id: 'T2V-01-Director',
    parameters: {
      duration: { default: 6, enum: [6] },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-02-11',
    type: 'video',
  },
  {
    description: 'Enhanced character performance: more stable, smoother, and more vivid.',
    displayName: 'I2V 01 Live',
    id: 'I2V-01-live',
    parameters: {
      duration: { default: 6, enum: [6] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-03-03',
    type: 'video',
  },
  {
    description: 'The foundational image-to-video model of the 01 series.',
    displayName: 'I2V 01',
    id: 'I2V-01',
    parameters: {
      duration: { default: 6, enum: [6] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-03-03',
    type: 'video',
  },
  {
    description: 'The foundational reference-to-video model of the 01 series.',
    displayName: 'S2V 01',
    id: 'S2V-01',
    parameters: {
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-01-10',
    type: 'video',
  },
  {
    description: 'The foundational text-to-video model of the 01 series.',
    displayName: 'T2V 01',
    id: 'T2V-01',
    parameters: {
      duration: { default: 6, enum: [6] },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    releasedAt: '2025-03-03',
    type: 'video',
  },
];

export const allModels = [...minimaxChatModels, ...minimaxImageModels, ...minimaxVideoModels];

export default allModels;
