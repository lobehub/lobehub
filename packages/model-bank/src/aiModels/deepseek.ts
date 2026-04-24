import type { AIChatModelCard } from '../types/aiModel';

// https://api-docs.deepseek.com/zh-cn/quick_start/pricing
const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash is the cost-efficient member of the V4 family with a 1M context window and hybrid thinking. Thinking mode is on by default and can be toggled via the `thinking` parameter; non-thinking mode is optimized for latency-sensitive workflows.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParamOptions: {
        enableReasoning: {
          defaultValue: true,
          includeBudget: false,
        },
      },
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, optimized for high-intensity reasoning, agentic workflows, and long-horizon planning. Thinking mode is on by default and can be toggled via the `thinking` parameter.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParamOptions: {
        enableReasoning: {
          defaultValue: true,
          includeBudget: false,
        },
      },
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    // Per official docs: deepseek-chat is now a compatibility alias pointing to
    // the non-thinking mode of deepseek-v4-flash and is slated for deprecation.
    // Pricing and sizing mirror deepseek-v4-flash since that is what the endpoint serves.
    description:
      'Compatibility alias for DeepSeek V4 Flash non-thinking mode. Slated for deprecation — use deepseek-v4-flash instead.',
    displayName: 'DeepSeek V3.2 (routes to V4 Flash)',
    id: 'deepseek-chat',
    legacy: true,
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    // Per official docs: deepseek-reasoner is now a compatibility alias pointing
    // to the thinking mode of deepseek-v4-flash and is slated for deprecation.
    description:
      'Compatibility alias for DeepSeek V4 Flash thinking mode. Slated for deprecation — use deepseek-v4-flash instead.',
    displayName: 'DeepSeek V3.2 Thinking (routes to V4 Flash)',
    id: 'deepseek-reasoner',
    legacy: true,
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
];

export const allModels = [...deepseekChatModels];

export default allModels;
