import type { AIChatModelCard } from '../../../types/aiModel';

export const googleChatModels: AIChatModelCard[] = [
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
      "Gemini 3 Pro is Google's most powerful agent and vibe-coding model, delivering richer visuals and deeper interaction on top of state-of-the-art reasoning.",
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
      "Gemini 3 Flash Preview is Google's latest best-value model, improving on Gemini 2.5 Flash.",
    displayName: 'Gemini 3 Flash Preview',
    enabled: true,
    id: 'gemini-3-flash-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput',
          rate: 0.5,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          rate: 0.05,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
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
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description:
      "Gemini 2.5 Pro is Google's most advanced reasoning model, able to reason over code, math, and STEM problems and analyze large datasets, codebases, and documents with long context.",
    displayName: 'Gemini 2.5 Pro',
    enabled: true,
    id: 'gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.31, upTo: 200_000 },
            { rate: 0.625, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.25, upTo: 200_000 },
            { rate: 2.5, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-06-17',
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 65_536,
    description: "Gemini 2.5 Flash is Google's best-value model with full capabilities.",
    displayName: 'Gemini 2.5 Flash',
    id: 'gemini-2.5-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          rate: 0.03,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          rate: 0.3,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      "Gemini 3 Pro Image (Nano Banana Pro) is Google's image generation model and also supports multimodal chat.",
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
    settings: {
      searchImpl: 'params',
      searchProvider: 'google',
    },
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 32_768,
    description:
      "Nano Banana is Google's newest, fastest, and most efficient native multimodal model, enabling conversational image generation and editing.",
    displayName: 'Nano Banana',
    id: 'gemini-2.5-flash-image-preview',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'Gemini 2.0 Flash experimental model with image generation support.',
    displayName: 'Gemini 2.0 Flash (Image Generation) Experimental',
    id: 'gemini-2.0-flash-exp-image-generation',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-14',
    type: 'chat',
  },
];
