import type { AIChatModelCard } from '../types/aiModel';

// https://studio.nebius.com/

const nebiusChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'gpt-oss-120b',
    id: 'openai/gpt-oss-120b',
    organization: 'openai',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 110_000,
    displayName: 'Gemma-3-27b-it',
    id: 'google/gemma-3-27b-it',
    organization: 'google',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    displayName: 'Qwen2.5-VL-72B-Instruct',
    id: 'Qwen/Qwen2.5-VL-72B-Instruct',
    organization: 'Qwen',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

// export const nebiusEmbeddingModels: AIEmbeddingModelCard[] = [
//   {
//     contextWindowTokens: 40_960,
//     displayName: 'Qwen3-Embedding-8B',
//     id: 'Qwen/Qwen3-Embedding-8B',
//     maxDimension: 3072,
//     pricing: {
//       units: [
//         { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
//       ],
//     },
//     type: 'embedding',
//   },
// ];

export const allModels = [...nebiusChatModels];

export default allModels;
