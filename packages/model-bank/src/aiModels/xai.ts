import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

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
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'We’re excited to release Grok 4 Fast, our latest progress in cost-effective reasoning models.',
    displayName: 'Grok 4 Fast (Non-Reasoning)',
    id: 'grok-4-fast-non-reasoning',
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
    releasedAt: '2025-09-09',
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
      vision: true,
    },
    contextWindowTokens: 2_000_000,
    description:
      'We’re excited to release Grok 4 Fast, our latest progress in cost-effective reasoning models.',
    displayName: 'Grok 4 Fast',
    id: 'grok-4-fast-reasoning',
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
    releasedAt: '2025-09-09',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'We’re excited to launch grok-code-fast-1, a fast and cost-effective reasoning model that excels at agentic coding.',
    displayName: 'Grok Code Fast 1',
    id: 'grok-code-fast-1',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-27',
    // settings: {
    // reasoning_effort is not supported by grok-code. Specifying reasoning_effort parameter will get an error response.
    // extendParams: ['reasoningEffort'],
    // },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Our newest and strongest flagship model, excelling in NLP, math, and reasoning—an ideal all-rounder.',
    displayName: 'Grok 4 0709',
    enabled: true,
    id: 'grok-4',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-09',
    settings: {
      // reasoning_effort is not supported by grok-4. Specifying reasoning_effort parameter will get an error response.
      // extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A flagship model that excels at enterprise use cases like data extraction, coding, and summarization, with deep domain knowledge in finance, healthcare, law, and science.',
    displayName: 'Grok 3',
    id: 'grok-3',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-03',
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
    },
    contextWindowTokens: 131_072,
    description:
      'A lightweight model that thinks before responding. It’s fast and smart for logic tasks that don’t require deep domain knowledge, with access to raw reasoning traces.',
    displayName: 'Grok 3 Mini',
    id: 'grok-3-mini',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-03',
    settings: {
      extendParams: ['reasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'Improved accuracy, instruction following, and multilingual capability.',
    displayName: 'Grok 2 Vision 1212',
    id: 'grok-2-vision-1212', // legacy
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-12',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

const xaiImageModels: AIImageModelCard[] = [
  {
    description:
      'Our latest image generation model creates vivid, realistic images from prompts and excels in marketing, social media, and entertainment use cases.',
    displayName: 'Grok 2 Image 1212',
    enabled: true,
    id: 'grok-2-image-1212',
    parameters: {
      prompt: {
        default: '',
      },
    },
    releasedAt: '2024-12-12',
    type: 'image',
  },
];

export const allModels = [...xaiChatModels, ...xaiImageModels];

export default allModels;
