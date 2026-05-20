import type { AIChatModelCard } from '../../../types/aiModel';

export const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Kimi's latest and most capable model, delivering stronger long-horizon coding, instruction following, and self-correction while supporting text, image, and video inputs plus chat and agent tasks.",
    displayName: 'Kimi K2.6',
    enabled: true,
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is Kimi\'s most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, "thinking" and "non-thinking" modes, and both conversational and agent tasks.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 262_144,
    description:
      'kimi-k2 is an MoE foundation model with strong coding and agent capabilities (1T total params, 32B active). Based on kimi-k2-0711-preview, with enhanced agentic coding abilities and better context understanding.',
    displayName: 'Kimi K2',
    id: 'kimi-k2-0905-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 262_144,
    description:
      'High-speed version of kimi-k2, always aligned with the latest kimi-k2. Same model parameters, output speed up to 60–100 tokens/sec.',
    displayName: 'Kimi K2 Turbo',
    id: 'kimi-k2-turbo-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
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
    contextWindowTokens: 262_144,
    description:
      'K2 thinking model with general agentic and reasoning capabilities, specializing in deep reasoning tasks via multi-step tool use.',
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-06',
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
    contextWindowTokens: 262_144,
    description:
      'High-speed version of kimi-k2-thinking, suitable for scenarios requiring both deep reasoning and extremely fast responses.',
    displayName: 'Kimi K2 Thinking Turbo',
    id: 'kimi-k2-thinking-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-06',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
