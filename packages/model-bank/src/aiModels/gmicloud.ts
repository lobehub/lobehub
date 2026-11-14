import type { AIChatModelCard } from '../types/aiModel';

const gmicloudChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Pro is the flagship MoE model of the DeepSeek-V4 series, with 1.6T total and 49B active parameters and a native 1M-token context window. It is strong at coding, reasoning and agentic tasks.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Pro',
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.145, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.48, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_575,
    description:
      'DeepSeek-V4-Flash is the fast, low-cost MoE model of the DeepSeek-V4 series, with 284B total and 13B active parameters and a 1M-token context window.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Flash',
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.028, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
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
      "GLM-5.2 is Z.ai's flagship model for long-horizon tasks, with a stable 1M-token context window and stronger coding than GLM-5.1. Served in FP8.",
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'zai-org/GLM-5.2-FP8',
    organization: 'Zhipu',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.7 Code is an agentic coding model from Moonshot AI. This is the high-speed deployment, tuned for long-horizon software engineering work with lower latency.',
    displayName: 'Kimi K2.7 Code Highspeed',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'moonshotai/kimi-k2.7-code-highspeed',
    organization: 'Moonshot',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.8 Max handles complex coding, multimodal understanding and long-horizon agentic workflows.',
    displayName: 'Qwen3.8 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'Qwen/Qwen3.8-Max',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "MiniMax M3 is MiniMax's first multimodal model, with native image understanding and strong coding and agentic capabilities.",
    displayName: 'MiniMax M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'MiniMaxAI/MiniMax-M3',
    organization: 'MiniMax',
    pricing: {
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.06, upTo: 512_000 },
            { rate: 0.12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.3, upTo: 512_000 },
            { rate: 0.6, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.2, upTo: 512_000 },
            { rate: 2.4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-06-01',
    type: 'chat',
  },
];

export const allModels = [...gmicloudChatModels];

export default allModels;
