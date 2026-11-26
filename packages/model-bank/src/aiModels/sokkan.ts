import type { AIChatModelCard } from '../types/aiModel';

// Prices, limits and regions from https://router.sokkan.ch/v1/models (accessed 2026-11-03).
// Only models listed with `"availability": "on_demand"` are included: committed-throughput
// models return 403 on a pay-per-token key.
const sokkanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.6-35B-A3B, a Mixture-of-Experts model with 35B total and 3B active parameters, served in the EU.',
    displayName: 'Qwen3.6-35B-A3B (EU)',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen/qwen3.6-35b-a3b-eu',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'Qwen3.8-27B, a dense 27B model, served in the EU.',
    displayName: 'Qwen3.8-27B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen/qwen3.8-27b',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Qwen3.5-397B-A17B, a Mixture-of-Experts model with 397B total and 17B active parameters, served in the EU.',
    displayName: 'Qwen3.5-397B-A17B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen/qwen3.5-397b-a17b',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'OpenAI gpt-oss-120b open-weight reasoning model, served in the EU.',
    displayName: 'gpt-oss-120b',
    enabled: true,
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'openai/gpt-oss-120b',
    maxOutput: 32_768,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description: 'OpenAI gpt-oss-20b open-weight reasoning model, served in Switzerland.',
    displayName: 'gpt-oss-20b',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'openai/gpt-oss-20b',
    maxOutput: 32_768,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.008, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];

export const allModels = [...sokkanChatModels];

export default allModels;
