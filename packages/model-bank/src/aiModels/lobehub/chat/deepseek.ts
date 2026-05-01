import type { AIChatModelCard } from '../../../types/aiModel';

export const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash is the cost-efficient member of the V4 family with a 1M context window and hybrid thinking. Toggle thinking via the `thinking` parameter; non-thinking mode targets latency-sensitive workflows while thinking mode enables deeper reasoning.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    pricing: {
      // LobeHub-hosted discount price. Official DeepSeek API pricing stays in model-bank/deepseek.
      units: [
        { name: 'textInput_cacheRead', rate: 0.00028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.014, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.028, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, purpose-built for high-intensity reasoning, agent workflows, and long-horizon planning with a 1M context window. Thinking mode is on by default and toggleable via the `thinking` parameter.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    pricing: {
      // LobeHub-hosted discount price. Official DeepSeek API pricing stays in model-bank/deepseek.
      units: [
        { name: 'textInput_cacheRead', rate: 0.0003625, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.0435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.087, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    contextWindowTokens: 1_000_000,
    // Per official docs: deepseek-chat is now a compatibility alias that points
    // to the non-thinking mode of deepseek-v4-flash and will be deprecated.
    // Pricing and sizing mirror deepseek-v4-flash since that is what the endpoint serves.
    description:
      'Compatibility alias for DeepSeek V4 Flash non-thinking mode. Slated for deprecation — use DeepSeek V4 Flash instead.',
    displayName: 'DeepSeek V3.2 (routes to V4 Flash)',
    id: 'deepseek-chat',
    legacy: true,
    maxOutput: 384_000,
    pricing: {
      // LobeHub-hosted discount price. Official DeepSeek API pricing stays in model-bank/deepseek.
      units: [
        { name: 'textInput_cacheRead', rate: 0.00028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.014, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.028, strategy: 'fixed', unit: 'millionTokens' },
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
    // Per official docs: deepseek-reasoner is now a compatibility alias that
    // points to the thinking mode of deepseek-v4-flash and will be deprecated.
    description:
      'Compatibility alias for DeepSeek V4 Flash thinking mode. Slated for deprecation — use DeepSeek V4 Flash instead.',
    displayName: 'DeepSeek V3.2 Thinking (routes to V4 Flash)',
    id: 'deepseek-reasoner',
    legacy: true,
    maxOutput: 384_000,
    pricing: {
      // LobeHub-hosted discount price. Official DeepSeek API pricing stays in model-bank/deepseek.
      units: [
        { name: 'textInput_cacheRead', rate: 0.00028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.014, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
];
