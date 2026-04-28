import type { AIChatModelCard, AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

// https://docs.x.ai/docs/models
const xaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'A non-reasoning variant for simple use cases',
    displayName: 'Grok 4.20 (Non-Reasoning)',
    enabled: true,
    id: 'grok-4.20-0309-non-reasoning',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.2 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.2 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 0.2 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'Intelligent, blazing-fast model that reasons before responding',
    displayName: 'Grok 4.20',
    enabled: true,
    id: 'grok-4.20-0309-reasoning',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.2 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.2 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 0.2 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'A team of 4 or 16 agents, Excels at research use cases, Does not currently support client-side tools. Only supports xAI server side tools (eg X Search, Web Search tools) and remote MCP tools.',
    displayName: 'Grok 4.20 Multi-Agent',
    enabled: true,
    id: 'grok-4.20-multi-agent-0309',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.2 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.2 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 0.2 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-09',
    settings: {
      extendParams: ['grok4_20ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'A frontier multimodal model optimized for high-performance agent tool use.',
    displayName: 'Grok 4.1 Fast (Non-Reasoning)',
    enabled: true,
    id: 'grok-4-1-fast-non-reasoning',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.128 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 0.128 },
            { rate: 1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description: 'A frontier multimodal model optimized for high-performance agent tool use.',
    displayName: 'Grok 4.1 Fast',
    enabled: true,
    id: 'grok-4-1-fast-reasoning',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.128 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 0.128 },
            { rate: 1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

const xaiImageModels: AIImageModelCard[] = [
  {
    description:
      'Generate images from text prompts, edit existing images with natural language, or iteratively refine images through multi-turn conversations.',
    displayName: 'Grok Imagine Image Pro',
    enabled: true,
    id: 'grok-imagine-image-pro',
    parameters: {
      aspectRatio: {
        default: 'auto',
        enum: [
          'auto',
          '1:1',
          '3:4',
          '4:3',
          '9:16',
          '16:9',
          '2:3',
          '3:2',
          '9:19.5',
          '19.5:9',
          '9:20',
          '20:9',
          '1:2',
          '2:1',
        ],
      },
      imageUrls: { default: [] },
      prompt: {
        default: '',
      },
      resolution: {
        default: '1k',
        enum: ['1k', '2k'],
      },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.07, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-28',
    type: 'image',
  },
  {
    description:
      'Generate images from text prompts, edit existing images with natural language, or iteratively refine images through multi-turn conversations.',
    displayName: 'Grok Imagine Image',
    enabled: true,
    id: 'grok-imagine-image',
    parameters: {
      aspectRatio: {
        default: 'auto',
        enum: [
          'auto',
          '1:1',
          '3:4',
          '4:3',
          '9:16',
          '16:9',
          '2:3',
          '3:2',
          '9:19.5',
          '19.5:9',
          '9:20',
          '20:9',
          '1:2',
          '2:1',
        ],
      },
      imageUrls: { default: [] },
      prompt: {
        default: '',
      },
      resolution: {
        default: '1k',
        enum: ['1k', '2k'],
      },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-28',
    type: 'image',
  },
];

const xaiVideoModels: AIVideoModelCard[] = [
  {
    description: 'State-of-the-art video generation across quality, cost, and latency.',
    displayName: 'Grok Imagine Video',
    enabled: true,
    id: 'grok-imagine-video',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'],
      },
      duration: { default: 8, max: 15, min: 1 },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '480p',
        enum: ['480p', '720p'],
      },
      size: {
        default: '848x480',
        enum: ['848x480', '1696x960', '1280x720', '1920x1080'],
      },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.05, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
];

export const allModels = [...xaiChatModels, ...xaiImageModels, ...xaiVideoModels];

export default allModels;
