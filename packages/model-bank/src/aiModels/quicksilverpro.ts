import type { AIChatModelCard } from '../types/aiModel';

// Prices come from the QuickSilver Pro machine-readable catalog (USD per 1M tokens):
// https://quicksilverpro.io/pricing.json
const quicksilverProChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    displayName: 'Claude Opus 5.5',
    enabled: true,
    family: 'claude-opus',
    generation: 'claude-5.5',
    id: 'claude-opus-5-5',
    knowledgeCutoff: '2026-06',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    displayName: 'Claude Sonnet 5.5',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-5.5',
    id: 'claude-sonnet-5-5',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'GPT-6.1 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'gpt-6.1-sol',
    knowledgeCutoff: '2026-04',
    maxOutput: 128_000,
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 200_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.1, upTo: 200_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 10, upTo: 200_000 },
            { rate: 15, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'Gemini 3.8 Flash',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.8',
    id: 'gemini-3.8-flash',
    knowledgeCutoff: '2026-03',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.1875, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 500_000,
    displayName: 'Grok 4.7',
    enabled: true,
    family: 'grok',
    generation: 'grok-4.7',
    id: 'grok-4.7',
    knowledgeCutoff: '2026-05',
    pricing: {
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 200_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.5, upTo: 200_000 },
            { rate: 1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 6, upTo: 200_000 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
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
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'deepseek-v4.1-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.0125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'GLM 5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.208, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.52, strategy: 'fixed', unit: 'millionTokens' },
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
    displayName: 'GLM 5.3 Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.012, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    displayName: 'MiMo-V2.6-Pro',
    enabled: true,
    family: 'mimo',
    generation: 'mimo-v2.6',
    id: 'mimo-v2.6-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.348, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.00288, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.696, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    displayName: 'Qwen3.8 27B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen3.8-27b',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.34, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.068, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.425, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...quicksilverProChatModels];

export default allModels;
