import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';
import { imagenGenParameters, nanoBananaParameters } from './google';

// ref: https://cloud.google.com/vertex-ai/generative-ai/docs/learn/models
const vertexaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3 Pro is Google’s most powerful agent and vibe-coding model, delivering richer visuals and deeper interaction on top of state-of-the-art reasoning.',
    displayName: 'Gemini 3 Pro Preview',
    enabled: true,
    id: 'gemini-3-pro-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 200_000 },
            { rate: 0.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 200_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 12, upTo: 200_000 },
            { rate: 18, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          lookup: { prices: { '1h': 4.5 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-18',
    settings: {
      extendParams: ['thinkingLevel2', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 3 Flash is the smartest model built for speed, combining cutting-edge intelligence with excellent search grounding.',
    displayName: 'Gemini 3 Flash Preview',
    enabled: true,
    id: 'gemini-3-flash-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 1 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-17',
    settings: {
      extendParams: ['thinkingLevel', 'urlContext'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 131_072 + 32_768,
    description:
      'Gemini 3 Pro Image（Nano Banana Pro）是 Google 的图像生成模型，同时支持多模态对话。',
    displayName: 'Nano Banana Pro',
    enabled: true,
    id: 'gemini-3-pro-image-preview',
    maxOutput: 32_768,
    pricing: {
      approximatePricePerImage: 0.134,
      units: [
        { name: 'imageOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    settings: {
      searchImpl: 'params',
      searchProvider: 'google',
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
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro is Google’s most advanced reasoning model, able to reason over code, math, and STEM problems and analyze large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro',
    id: 'gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.31, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro Preview is Google’s most advanced reasoning model, able to reason over code, math, and STEM problems and analyze large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro Preview 05-06',
    id: 'gemini-2.5-pro-preview-05-06',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      'Gemini 2.5 Pro Preview is Google’s most advanced reasoning model, able to reason over code, math, and STEM problems and analyze large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro Preview 03-25',
    id: 'gemini-2.5-pro-preview-03-25',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash is Google’s best-value model with full capabilities.',
    displayName: 'Gemini 2.5 Flash',
    id: 'gemini-2.5-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: 'Gemini 2.5 Flash Preview is Google’s best-value model with full capabilities.',
    displayName: 'Gemini 2.5 Flash Preview 04-17',
    id: 'gemini-2.5-flash-preview-04-17',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description:
      'Nano Banana is Google’s newest, fastest, and most efficient native multimodal model, enabling conversational image generation and editing.',
    displayName: 'Nano Banana',
    enabled: true,
    id: 'gemini-2.5-flash-image',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000 + 64_000,
    description:
      'Gemini 2.5 Flash-Lite is Google’s smallest, best-value model, designed for large-scale use.',
    displayName: 'Gemini 2.5 Flash-Lite',
    id: 'gemini-2.5-flash-lite',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-22',
    settings: {
      extendParams: ['thinkingBudget'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000 + 64_000,
    description:
      'Gemini 2.5 Flash-Lite Preview is Google’s smallest, best-value model, designed for large-scale use.',
    displayName: 'Gemini 2.5 Flash-Lite Preview 06-17',
    id: 'gemini-2.5-flash-lite-preview-06-17',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['thinkingBudget'],
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash delivers next-gen features including exceptional speed, native tool use, multimodal generation, and a 1M-token context window.',
    displayName: 'Gemini 2.0 Flash',
    id: 'gemini-2.0-flash',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.0375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description: 'A Gemini 2.0 Flash variant optimized for cost efficiency and low latency.',
    displayName: 'Gemini 2.0 Flash-Lite',
    id: 'gemini-2.0-flash-lite',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000 + 8192,
    description:
      'Gemini 1.5 Flash 002 is an efficient multimodal model built for broad deployment.',
    displayName: 'Gemini 1.5 Flash 002',
    id: 'gemini-1.5-flash-002',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_000_000 + 8192,
    description:
      'Gemini 1.5 Pro 002 is the latest production-ready model with higher-quality output, especially for math, long context, and vision tasks.',
    displayName: 'Gemini 1.5 Pro 002',
    id: 'gemini-1.5-pro-002',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-24',
    type: 'chat',
  },
];

/* eslint-disable sort-keys-fix/sort-keys-fix */
const vertexaiImageModels: AIImageModelCard[] = [
  {
    displayName: 'Nano Banana',
    id: 'gemini-2.5-flash-image:image',
    enabled: true,
    type: 'image',
    description:
      'Nano Banana is Google’s newest, fastest, and most efficient native multimodal model, enabling conversational image generation and editing.',
    releasedAt: '2025-08-26',
    parameters: nanoBananaParameters,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
  },
  {
    displayName: 'Imagen 4',
    id: 'imagen-4.0-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Ultra',
    id: 'imagen-4.0-ultra-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series Ultra version',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
  },
  {
    displayName: 'Imagen 4 Fast',
    id: 'imagen-4.0-fast-generate-001',
    enabled: true,
    type: 'image',
    description: 'Imagen 4th generation text-to-image model series Fast version',
    organization: 'Deepmind',
    releasedAt: '2025-08-15',
    parameters: imagenGenParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
  },
];

export const allModels = [...vertexaiChatModels, ...vertexaiImageModels];

export default allModels;
