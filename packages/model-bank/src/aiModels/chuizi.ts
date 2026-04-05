import { type AIChatModelCard } from '../types/aiModel';

// Chuizi.AI routes through provider/model naming and applies a unified
// upstream-cost × 1.05 multiplier. Pricing below reflects the final USD
// price per 1M tokens that Chuizi.AI charges (already includes the 5%
// gateway margin on top of upstream list prices).
// Models use the `provider/model` format required by Chuizi.AI's router.

const chuiziChatModels: AIChatModelCard[] = [
  // ----- Anthropic -----
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.6 — Anthropic’s most capable model, optimized for complex reasoning, agents, and long-form analysis.',
    displayName: 'Claude Opus 4.6',
    enabled: true,
    id: 'anthropic/claude-opus-4-6',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 78.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-15',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4.6 — balanced model, default choice for Claude Code, Cursor, Cline and most agent workflows.',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    id: 'anthropic/claude-sonnet-4-6',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-15',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Claude Haiku 4.5 — fastest Claude model, ideal for high-volume and latency-sensitive tasks.',
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'anthropic/claude-haiku-4-5',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    type: 'chat',
  },

  // ----- OpenAI -----
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 400_000,
    description: 'GPT-5 — frontier reasoning model from OpenAI via Azure.',
    displayName: 'GPT-5',
    enabled: true,
    id: 'openai/gpt-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.3125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-01',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 400_000,
    description: 'GPT-5.1 — latest general-purpose flagship, improved reasoning and multimodality.',
    displayName: 'GPT-5.1',
    enabled: true,
    id: 'openai/gpt-5.1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.3125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-20',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'GPT-4.1 — flagship with 200K context, excellent balance of price and capability.',
    displayName: 'GPT-4.1',
    enabled: true,
    id: 'openai/gpt-4.1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'o4-mini — fast compact reasoning model, strong on STEM and code.',
    displayName: 'o4-mini',
    enabled: true,
    id: 'openai/o4-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.155, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.62, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-16',
    type: 'chat',
  },

  // ----- Google -----
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 2_097_152,
    description:
      'Gemini 2.5 Pro — Google’s flagship with 2M context, strong multimodality and reasoning.',
    displayName: 'Gemini 2.5 Pro',
    enabled: true,
    id: 'google/gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.3125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description: 'Gemini 2.5 Flash — fast, cost-effective multimodal model.',
    displayName: 'Gemini 2.5 Flash',
    enabled: true,
    id: 'google/gemini-2.5-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.315, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    type: 'chat',
  },

  // ----- DeepSeek -----
  {
    abilities: { functionCall: true },
    contextWindowTokens: 131_072,
    description: 'DeepSeek V3.2 — latest general model with hybrid reasoning and agent skills.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek/deepseek-chat',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.294, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.176, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek R1 — reasoning-optimized model with full chain-of-thought output.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek/deepseek-r1',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.588, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.352, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-20',
    type: 'chat',
  },

  // ----- Qwen -----
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Qwen3 Max — Alibaba’s flagship, 1M context, strong on Chinese and multimodal tasks.',
    displayName: 'Qwen3 Max',
    enabled: true,
    id: 'qwen/qwen3-max',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.52, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },

  // ----- xAI -----
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 256_000,
    description: 'Grok 4 — xAI flagship with strong reasoning and realtime context.',
    displayName: 'Grok 4',
    enabled: true,
    id: 'xai/grok-4',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 3.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-10',
    type: 'chat',
  },

  // ----- Moonshot -----
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 200_000,
    description: 'Kimi K2.5 — Moonshot’s latest long-context flagship, excellent for code agents.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'moonshot/kimi-k2.5',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.52, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-01',
    type: 'chat',
  },

  // ----- ZhiPu -----
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description: 'GLM-4.6 — ZhiPu’s flagship with strong Chinese reasoning and tool use.',
    displayName: 'GLM-4.6',
    enabled: true,
    id: 'zhipu/glm-4.6',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.525, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-01',
    type: 'chat',
  },
];

export const allModels = [...chuiziChatModels];

export default allModels;
