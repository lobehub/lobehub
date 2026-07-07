import { type AIChatModelCard } from '../types/aiModel';

// ref: https://opencode.ai/go
// Models synced from `opencode models opencode-go`

const opencodeCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 202_752,
    description:
      'GLM-5.1 by Zhipu AI — latest generation coding model with enhanced reasoning and tool use capabilities.',
    displayName: 'GLM-5.1',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 32_768,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-07',
    type: 'chat',
  },

  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Moonshot AI's latest flagship model, delivering significant improvements in coding, agentic tasks, and multimodal understanding. It supports both 'thinking' and 'non-thinking' modes.",
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 65_536,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2.5 by Xiaomi — a leap in agency and multimodality. Native visual and audio understanding with strong agentic performance.',
    displayName: 'MiMo-V2.5',
    enabled: false,
    family: 'mimo',
    id: 'mimo-v2.5',
    knowledgeCutoff: '2024-12',
    maxOutput: 128_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_048_576,
    description:
      'MiMo-V2.5-Pro by Xiaomi — a leap in agentic and long horizon coherence. Significant improvements in agentic performance, software engineering, and tasks spanning 1000+ tool calls.',
    displayName: 'MiMo-V2.5 Pro',
    enabled: false,
    family: 'mimo',
    id: 'mimo-v2.5-pro',
    knowledgeCutoff: '2024-12',
    maxOutput: 128_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-22',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },

  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax M2.7 — latest MiniMax coding model with improved reasoning and tool use.',
    displayName: 'MiniMax M2.7',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimax-m2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 512_000,
    description:
      'MiniMax M3 — latest MiniMax model with vision support, strong reasoning, and improved tool use.',
    displayName: 'MiniMax M3',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-31',
    settings: {
      extendParams: ['enableAdaptiveThinking'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.6-Plus by Alibaba — latest Qwen coding model with strong reasoning and vision capabilities.',
    displayName: 'Qwen3.6 Plus',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-02',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max by Alibaba — latest Max variant with 1M context, strong reasoning, and tool use capabilities.',
    displayName: 'Qwen3.7 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-max',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-21',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description:
      "DeepSeek V4 Pro is DeepSeek's most capable 1M-context flagship model, supporting both non-thinking and thinking modes for advanced reasoning and tool use.",
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.48, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description:
      "DeepSeek V4 Flash is DeepSeek's fast 1M-context flagship model, supporting both non-thinking and thinking modes with strong agent capabilities.",
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.7 Code is Moonshot AI's coding-focused agentic model built upon Kimi K2.6, with substantial improvements on real-world long-horizon coding tasks and roughly 30% lower thinking-token usage.",
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 128_000,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-03',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_048_576,
    description:
      "GLM-5.2 is Z.ai's flagship model for the era of long-horizon tasks, with a truly usable 1M-token context window, stronger coding capabilities with multiple thinking effort levels, and an MIT open-source license.",
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 32_768,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-03',
    type: 'chat',
  },

  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Plus by Alibaba — cost-effective multimodal model with 1M context, strong reasoning, and vision capabilities.',
    displayName: 'Qwen3.7 Plus',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-01',
    type: 'chat',
  },
];

export default opencodeCodingPlanChatModels;
