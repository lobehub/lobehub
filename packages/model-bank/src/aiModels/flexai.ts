import type { AIChatModelCard, AIEmbeddingModelCard } from '../types/aiModel';

// https://flex.ai/models
// Catalogue metadata (context window, pricing, display name) mirrors
// GET https://api.flex.ai/v1/models as of 2026-11-11.
// Abilities are probed against the live endpoint rather than read from that
// response, which under-reports image input on three models and over-reports
// it on one (see the PR description for the per-model results).
// MiniMax-M3.1-Flash and MiMo-V2.6-Flash-RL joined the catalogue on 2026-11-11;
// their abilities are taken from the response's `supports` and not yet probed.

const flexaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'DeepSeek V4.1 Flash 1017',
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'DeepSeek-V4.1-Flash-1017',
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.605, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0055, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'DeepSeek V4 Flash 0731',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'DeepSeek-V4-Flash-0731',
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0195, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'GLM 5.3 Flash',
    family: 'glm',
    generation: 'glm-5.3',
    id: 'GLM-5.3-Flash',
    organization: 'Zhipu',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.088, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0132, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'GLM 5.2',
    family: 'glm',
    generation: 'glm-5.2',
    id: 'GLM-5.2',
    organization: 'Zhipu',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GLM 4.5 Air FP8',
    family: 'glm',
    generation: 'glm-4.5',
    id: 'GLM-4.5-Air-FP8',
    organization: 'Zhipu',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.86, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.021, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3.8 Flash Next',
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'Qwen3.8-Flash-Next',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.47, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0225, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3.8 27B',
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'Qwen3.8-27B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3.6-35B-A3B',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'Qwen3.6-35B-A3B-FP8',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3.6-27B',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'Qwen3.6-27B-FP8',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3.5 9B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'Qwen3.5-9B',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3 Coder 30B A3B',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen3-Coder-30B-A3B-Instruct-FP8',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0105, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen 3 30B Thinking',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen3-30B-A3B-Thinking-2507-FP8',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GPT-OSS 120B',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss-120b',
    organization: 'OpenAI',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0045, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GPT-OSS 20B',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss-20b',
    organization: 'OpenAI',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0027, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Gemma 4 31B IT',
    family: 'gemma',
    generation: 'gemma-4',
    id: 'gemma-4-31b-it',
    organization: 'Google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.021, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Gemma 4 26B A4B',
    family: 'gemma',
    generation: 'gemma-4',
    id: 'gemma-4-26B-A4B-it',
    organization: 'Google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.067, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 3.3 70B Instruct',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'Llama-3.3-70B-Instruct-FP8',
    organization: 'Meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.033, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 3.1 8B Instruct',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'Meta-Llama-3.1-8B-Instruct-FP8',
    organization: 'Meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Muse Glimmer 30B',
    id: 'Muse-Glimmer-30B',
    organization: 'Meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'MiniMax M3.1 Flash',
    family: 'minimax',
    generation: 'minimax-m3.1',
    id: 'MiniMax-M3.1-Flash',
    organization: 'MiniMax',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'MiMo V2.6 Flash RL',
    family: 'mimo',
    id: 'MiMo-V2.6-Flash-RL',
    organization: 'Xiaomi',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0037, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'Nemotron 3.5 Lightning 30B A3B',
    id: 'NVIDIA-Nemotron-3.5-Lightning-30B-A3B',
    organization: 'NVIDIA',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.009, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Mistral Nemo 12B',
    family: 'mistral',
    id: 'Mistral-Nemo-Instruct-2407-FP8',
    organization: 'Mistral',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.023, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0034, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const flexaiEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 8192,
    displayName: 'BGE-M3',
    id: 'bge-m3',
    maxDimension: 1024,
    organization: 'BAAI',
    pricing: {
      units: [{ name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
];

export const allModels = [...flexaiChatModels, ...flexaiEmbeddingModels];

export default allModels;
