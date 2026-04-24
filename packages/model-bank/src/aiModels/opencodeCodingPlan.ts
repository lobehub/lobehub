import { type AIChatModelCard } from '../types/aiModel';

// ref: https://opencode.ai/go
// Model data sourced from models.dev API (opencode-go provider)

const opencodeCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description:
      'GLM-5.1 by Zhipu AI — latest generation coding model with enhanced reasoning and tool use capabilities.',
    displayName: 'GLM-5.1',
    enabled: true,
    id: 'glm-5.1',
    maxOutput: 32_000,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-07',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description:
      'GLM-5 by Zhipu AI — high-performance coding model with strong reasoning abilities.',
    displayName: 'GLM-5',
    enabled: false,
    id: 'glm-5',
    maxOutput: 32_000,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-11',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 by Moonshot AI — advanced reasoning model with vision support for images and video input.',
    displayName: 'Kimi K2.5',
    enabled: false,
    id: 'kimi-k2.5',
    maxOutput: 32_000,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Omni by Xiaomi — multimodal model supporting text, image, audio, and PDF input.',
    displayName: 'MiMo-V2 Omni',
    enabled: false,
    id: 'mimo-v2-omni',
    maxOutput: 32_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.6-Plus by Alibaba — latest Qwen coding model with strong reasoning and vision capabilities.',
    displayName: 'Qwen3.6 Plus',
    enabled: true,
    id: 'qwen3.6-plus',
    maxOutput: 32_000,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-02',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.5 — efficient coding model with strong reasoning and function call support.',
    displayName: 'MiniMax M2.5',
    enabled: false,
    id: 'minimax-m2.5',
    maxOutput: 32_000,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax M2.7 — latest MiniMax coding model with improved reasoning and tool use.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'minimax-m2.7',
    maxOutput: 32_000,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_048_576,
    description: 'MiMo-V2-Pro by Xiaomi — high-throughput model with 1M token context window.',
    displayName: 'MiMo-V2 Pro',
    enabled: false,
    id: 'mimo-v2-pro',
    maxOutput: 32_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5-Plus by Alibaba — cost-effective coding model with vision support for image and video input.',
    displayName: 'Qwen3.5 Plus',
    enabled: false,
    id: 'qwen3.5-plus',
    maxOutput: 32_000,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-16',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];

export default opencodeCodingPlanChatModels;
