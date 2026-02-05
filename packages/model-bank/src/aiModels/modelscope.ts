import type { AIChatModelCard } from '../types/aiModel';

const modelscopeChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'Qwen/Qwen3-Next-80B-A3B-Thinking',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.2 Exp uses a hybrid reasoning architecture and supports both thinking and non-thinking modes.',
    displayName: 'DeepSeek V3.2 Exp',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3.2-Exp',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.1 uses a hybrid reasoning architecture and supports both thinking and non-thinking modes.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-ai/DeepSeek-V3.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek R1 leverages additional compute and post-training algorithmic optimizations to deepen reasoning. It performs strongly across benchmarks in math, programming, and general logic, approaching leaders like o3 and Gemini 2.5 Pro.',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek-ai/DeepSeek-R1-0528',
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
    id: 'Qwen/Qwen3-235B-A22B',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Qwen3 32B is a Qwen3 model with strong reasoning and chat capabilities.',
    displayName: 'Qwen3 32B',
    id: 'Qwen/Qwen3-32B',
    type: 'chat',
  },
];

export const allModels = [...modelscopeChatModels];

export default allModels;
