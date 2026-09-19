import type { AIChatModelCard } from '../types/aiModel';

// DeepSeek bills on a peak/off-peak schedule where the off-peak rate is half the
// peak rate, and `PricingStrategy` has no peak/off-peak dimension. These cards
// therefore carry the peak rate — the conservative choice for a cost estimate,
// because it never under-reports what a request may be billed at. Peak hours are
// Mon–Fri 09:00–12:00 and 14:00–18:00 (UTC+8).
// @see https://api-docs.deepseek.com/zh-cn/quick_start/pricing
const deepseekChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4.1 Flash is the smallest model of the new DeepSeek architecture family, with native multimodal image understanding, a 1M context window and hybrid thinking — one of the cheapest capable models available.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'deepseek-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
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
      'DeepSeek V4 Pro is the flagship of the V4 family, built for high-intensity reasoning and agentic workflows with a 1M context window — excellent Chinese writing and outstanding value for money.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-13',
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
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
    // Retired upstream on 2026-09-10. The name still resolves, but requests are now
    // served by V4.1-Flash and billed at V4.1-Flash rates — use `deepseek-flash`.
    description:
      'Retired upstream. The model name still resolves, but requests are served by DeepSeek V4.1 Flash at V4.1 Flash rates.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    legacy: true,
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-31',
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
    visible: false,
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    // Retired upstream on 2026-09-10, together with the experiment it shipped. The name
    // still resolves, but requests are served by V4.1-Flash, which is natively
    // multimodal — use `deepseek-flash`.
    description:
      'Retired upstream. The model name still resolves, but requests are served by DeepSeek V4.1 Flash, which is natively multimodal.',
    displayName: 'DeepSeek V4 Flash Vision Exp',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash-vision-exp',
    legacy: true,
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-21',
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
    visible: false,
  },
];

export const allModels = [...deepseekChatModels];

export default allModels;
