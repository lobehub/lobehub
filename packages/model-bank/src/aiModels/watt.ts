import type { AIChatModelCard } from '../types/aiModel';

// Watt Cloud model list from the official catalog (2026-10-23),
// https://www.watt-cloud.com/docs/
const wattChatModels: AIChatModelCard[] = [
  // DeepSeek series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description: 'Fast DeepSeek V4 lane for economical reasoning, coding, and long-context work',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'DeepSeek-V4-Flash',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description:
      'Official DeepSeek V4 Flash release with enhanced agentic capabilities and integrated DSpark speculative decoding',
    displayName: 'DeepSeek V4 Flash 0731',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'DeepSeek-V4-Flash-0731',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.44, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-31',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description: 'Open MoE flagship with million-token context for coding and long agent runs',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'DeepSeek-V4-Pro',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.38, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_048_576,
    description: 'DeepSeek V4.1 Flash model for reasoning and agentic coding',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'DeepSeek-V4.1-Flash',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'October 17 update of DeepSeek V4.1 Flash with improved reasoning, coding, agentic tasks, and visual understanding',
    displayName: 'DeepSeek V4.1 Flash 1017',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'DeepSeek-V4.1-Flash-1017',
    maxOutput: 384_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-10-17',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },

  // GLM series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 202_752,
    description:
      'Strong GLM coding model for agentic engineering, terminals, and repository generation',
    displayName: 'GLM-5.1',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'GLM-5.1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-07',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description: 'Open flagship GLM for long-horizon coding agents and million-token context work',
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'GLM-5.2',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-13',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description: 'Flagship GLM model for long-horizon coding, agents, and complex project delivery',
    displayName: 'GLM-5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'GLM-5.3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-14',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_048_576,
    description: 'Native multimodal GLM model for efficient coding and long-horizon agent tasks',
    displayName: 'GLM-5.3-Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'GLM-5.3-Flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-26',
    type: 'chat',
  },

  // Hunyuan series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_048_576,
    description:
      'A next-generation productivity model with significantly enhanced Agent and complex task execution capabilities.',
    displayName: 'Hy4 preview',
    enabled: true,
    family: 'hunyuan',
    generation: 'hunyuan-4',
    id: 'Hy4-preview',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.83, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-28',
    type: 'chat',
  },

  // Kimi series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 271_360,
    description: 'Earlier Kimi frontier model for long-context agents, coding, and multimodal work',
    displayName: 'Kimi K2.5',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'Kimi-K2.5',
    maxOutput: 180_224,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 271_360,
    description:
      'Coding-focused Kimi model, stronger on long-horizon repo work with less overthinking',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'Kimi-K2.7-Code',
    maxOutput: 262_144,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 1_048_576,
    description:
      'Multimodal Kimi model with 1M context and toggleable max-effort thinking for long-horizon agent work',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'Kimi-K3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-16',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },

  // MiniMax series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 524_288,
    description: 'MiniMax multimodal model for long-context coding, perception, and agent planning',
    displayName: 'MiniMax-M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'MiniMax-M3',
    maxOutput: 512_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-01',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },

  // Qwen series
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 262_144,
    description: 'Qwen vision-language model for visual reasoning, documents, and agent tasks',
    displayName: 'Qwen3.5 122B-A10B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'Qwen3.5-122B-A10B',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-23',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 262_144,
    description: 'Qwen vision-language model for visual reasoning, documents, and agent tasks',
    displayName: 'Qwen3.5 27B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'Qwen3.5-27B',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-23',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 262_144,
    description: 'Qwen vision-language model for visual reasoning, documents, and agent tasks',
    displayName: 'Qwen3.5 35B-A3B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'Qwen3.5-35B-A3B',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-23',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true, vision: true },
    contextWindowTokens: 262_144,
    description: 'Large open Qwen multimodal MoE for visual agents and long technical tasks',
    displayName: 'Qwen3.5 397B-A17B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'Qwen3.5-397B-A17B',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export const allModels = [...wattChatModels];

export default allModels;
