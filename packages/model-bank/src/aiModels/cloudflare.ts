import type { AIChatModelCard } from '../types/aiModel';

const cloudflareChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 80_000,
    displayName: 'deepseek r1 (distill qwen 32b)',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
    id: '@cf/deepseek-ai/deepseek-r1-distill-qwen-32b',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 24_000,
    displayName: 'qwq 32b',
    enabled: true,
    family: 'qwen',
    generation: 'qwq',
    id: '@cf/qwen/qwq-32b',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    displayName: 'qwen2.5 coder 32b',
    family: 'qwen',
    generation: 'qwen2.5',
    id: '@cf/qwen/qwen2.5-coder-32b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 80_000,
    displayName: 'gemma 3 12b',
    family: 'gemma',
    generation: 'gemma-3',
    id: '@cf/google/gemma-3-12b-it',
    knowledgeCutoff: '2024-08',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 24_000,
    displayName: 'llama 3.3 70b',
    family: 'llama',
    generation: 'llama-3.3',
    id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_000,
    displayName: 'llama 4 17b',
    family: 'llama',
    generation: 'llama-4',
    id: '@cf/meta/llama-4-scout-17b-16e-instruct',
    knowledgeCutoff: '2024-08',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'mistral small 3.1 24b',
    family: 'mistral',
    id: '@cf/mistralai/mistral-small-3.1-24b-instruct',
    knowledgeCutoff: '2023-10',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    displayName: 'openchat-3.5-0106',
    id: '@cf/openchat/openchat-3.5-0106',
    type: 'chat',
  },
  {
    contextWindowTokens: 7500,
    displayName: 'qwen1.5-14b-chat-awq',
    enabled: true,
    family: 'qwen',
    generation: 'qwen1.5',
    id: '@cf/qwen/qwen1.5-14b-chat-awq',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    displayName: 'llama 3.1 8b',
    family: 'llama',
    generation: 'llama-3.1',
    id: '@cf/meta/llama-3.1-8b-instruct-fast',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
];

export const allModels = [...cloudflareChatModels];

export default allModels;
