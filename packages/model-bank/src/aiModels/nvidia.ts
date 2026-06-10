import { type AIChatModelCard } from '../types/aiModel';

const nvidiaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    displayName: 'MiniMax-M2.7',
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimaxai/minimax-m2.7',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'An advanced LLM strong at reasoning, math, common sense, and function calling.',
    displayName: 'Llama 3.3 70B Instruct',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'meta/llama-3.3-70b-instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A frontier vision-language model that excels at high-quality reasoning from images.',
    displayName: 'Llama 3.2 11B Vision Instruct',
    family: 'llama',
    generation: 'llama-3.2',
    id: 'meta/llama-3.2-11b-vision-instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A frontier vision-language model that excels at high-quality reasoning from images.',
    displayName: 'Llama 3.2 90B Vision Instruct',
    family: 'llama',
    generation: 'llama-3.2',
    id: 'meta/llama-3.2-90b-vision-instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A cutting-edge model with strong language understanding, reasoning, and text generation.',
    displayName: 'Llama 3.1 8B Instruct',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'meta/llama-3.1-8b-instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Built for complex dialogue with excellent context understanding, reasoning, and text generation.',
    displayName: 'Llama 3.1 70B Instruct',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'meta/llama-3.1-70b-instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'A distinctive language model delivering exceptional accuracy and efficiency.',
    displayName: 'Llama 3.1 Nemotron 51B Instruct',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'nvidia/llama-3.1-nemotron-51b-instruct',
    knowledgeCutoff: '2023',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Llama-3.1-Nemotron-70B-Instruct is a custom NVIDIA model designed to improve the helpfulness of LLM responses.',
    displayName: 'Llama 3.1 Nemotron 70B Instruct',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'An advanced small language model designed for edge applications.',
    displayName: 'Gemma 2 2B Instruct',
    family: 'gemma',
    generation: 'gemma-2',
    id: 'google/gemma-2-2b-it',
    type: 'chat',
  },
];

export const allModels = [...nvidiaChatModels];

export default allModels;
