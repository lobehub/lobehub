import type { AIChatModelCard } from '../types/aiModel';

const unslothChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 is the latest generation of the Qwen series, supporting seamless switching between thinking and non-thinking modes.',
    displayName: 'Qwen3 1.7B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3',
    id: 'unsloth/Qwen3-1.7B-GGUF',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Gemma 3 is a lightweight open model family from Google, supporting multimodal input and strong instruction following.',
    displayName: 'Gemma 3 4B',
    enabled: true,
    family: 'gemma',
    generation: 'gemma-3',
    id: 'unsloth/gemma-3-4b-it-GGUF',
    knowledgeCutoff: '2024-08',
    type: 'chat',
  },
];

export const allModels = [...unslothChatModels];

export default allModels;
