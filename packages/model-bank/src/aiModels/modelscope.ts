import type { AIChatModelCard } from '../types/aiModel';

const modelscopeChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 Next 80B A3B Thinking',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen/Qwen3-Next-80B-A3B-Thinking',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 Next 80B A3B Instruct',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 235B A22B is the Qwen3 ultra-scale model delivering top-tier AI capability.',
    displayName: 'Qwen3 235B A22B',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen/Qwen3-235B-A22B',
    type: 'chat',
  },
];

export const allModels = [...modelscopeChatModels];

export default allModels;
