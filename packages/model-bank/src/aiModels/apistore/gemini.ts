import type { AIChatModelCard } from '../../types/aiModel';

export const apistoreGeminiModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 3.1 Pro Preview improves on Gemini 3 Pro with enhanced reasoning capabilities and adds medium thinking level support.',
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'gemini-3.1-pro-preview',
    knowledgeCutoff: '2025-01',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.14, upTo: 200_000 },
            { rate: 0.28, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 200_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 8.4, upTo: 200_000 },
            { rate: 12.6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-19',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Gemini 3.5 Flash-Lite is Google's fastest, most cost-efficient 3.5 model for high-throughput agentic tasks, document parsing, and simple data extraction.",
    displayName: 'Gemini 3.5 Flash-Lite',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-3.5',
    id: 'gemini-3.5-flash-lite',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.021, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-21',
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Gemini 3.8 Flash is Google's most intelligent Flash model, engineered for long-horizon software engineering, autonomous agents, and complex enterprise workflows.",
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.8',
    id: 'gemini-3.8-flash',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0525, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.525, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Gemini 4 Argon is Google's flagship reasoning model, built for complex software engineering, deep math and science, autonomous multi-step agents, and long decode up to 1M tokens.",
    displayName: 'Gemini 4 Argon',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-4',
    id: 'gemini-4-argon',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-13',
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Gemini 4 Carbon is Google's strongest model, with state-of-the-art cybersecurity and long-horizon capabilities for sustained agentic coding, multimodal knowledge work, and scientific reasoning.",
    displayName: 'Gemini 4 Carbon',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-4',
    id: 'gemini-4-carbon',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-11-10',
    settings: {
      disabledParams: ['temperature', 'top_p'],
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'Gemini 4 Hydrogen',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-4',
    id: 'gemini-4-hydrogen',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0525, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];
