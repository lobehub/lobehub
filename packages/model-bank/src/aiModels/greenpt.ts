import type { AIASRModelCard, AIChatModelCard, AIEmbeddingModelCard } from '../types/aiModel';

// GreenPT publishes prices in EUR. USD rates use the ECB reference rate for 2026-07-24:
// 1 EUR = 1.1377 USD.
// https://docs.greenpt.ai/pricing
// https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
const greenptChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'GreenPT Code flagship model for long-horizon reasoning, agentic tool use, and multi-file software engineering.',
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.501764, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.256174, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['glm5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Moonshot Kimi K2.7 Code, served by GreenPT and tuned for software engineering and agentic coding tasks.',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 262_144,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.944291, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.380145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
];

const greenptEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    contextWindowTokens: 32_768,
    description:
      'GreenPT multilingual dense embedding model for semantic search, retrieval, clustering, and RAG.',
    displayName: 'Green Embedding',
    enabled: true,
    family: 'qwen',
    id: 'green-embedding',
    maxDimension: 2560,
    pricing: {
      currency: 'USD',
      units: [{ name: 'textInput', rate: 0.22754, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2025-06-01',
    type: 'embedding',
  },
];

const greenptASRModels: AIASRModelCard[] = [
  {
    description: 'GreenPT speech-to-text model for pre-recorded and live transcription.',
    displayName: 'GreenS',
    enabled: true,
    id: 'green-s',
    pricing: {
      currency: 'USD',
      units: [{ name: 'audioInput', rate: 0.000072686, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-01',
    type: 'asr',
  },
  {
    description: 'GreenPT advanced speech-to-text model with multilingual transcription support.',
    displayName: 'GreenS Pro',
    enabled: true,
    id: 'green-s-pro',
    pricing: {
      currency: 'USD',
      units: [{ name: 'audioInput', rate: 0.000072686, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-01',
    type: 'asr',
  },
];

export const allModels = [...greenptChatModels, ...greenptEmbeddingModels, ...greenptASRModels];

export default allModels;
