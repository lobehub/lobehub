import type { AIChatModelCard } from '../types/aiModel';

// https://api-docs.deepseek.com/zh-cn/quick_start/pricing
const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Flash is DeepSeek’s fast 1M-context flagship model, supporting both non-thinking and thinking modes with strong agent capabilities.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      // Official cache-hit input price is permanently reduced to 1/10 of the launch price.
      units: [
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Pro is DeepSeek’s most capable 1M-context flagship model, supporting both non-thinking and thinking modes for advanced reasoning and tool use.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      // Official cache-hit input price is permanently reduced to 1/10 of the launch price.
      // DeepSeek V4 Pro limited-time 75% off discount is valid until 2026-05-05 23:59 Beijing time.
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
];

export const allModels = [...deepseekChatModels];

export default allModels;
