import type { AIChatModelCard } from '../types/aiModel';

// ref: https://pinstripes.io
const pinstripesChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V4 Flash is a high-performance MoE model offering exceptional speed and quality, ideal for a wide range of conversational and reasoning tasks.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    id: 'ps/deepseek-v4-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5-Air is a lightweight yet capable model from Zhipu AI, optimized for efficiency with strong instruction-following and multilingual support.',
    displayName: 'GLM-4.5-Air',
    enabled: true,
    family: 'glm',
    id: 'ps/glm-4.5-air',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Qwen3 35B is a high-quality dense model from Alibaba Cloud, delivering strong reasoning, coding, and instruction-following capabilities.',
    displayName: 'Qwen3 35B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3',
    id: 'ps/qwen3-35b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 1_000_000,
    description:
      'MiniMax M2.7 is a powerful flagship model from MiniMax with an ultra-long context window, excelling at complex reasoning, coding, and long-document understanding.',
    displayName: 'MiniMax M2.7',
    enabled: true,
    family: 'minimax',
    id: 'ps/minimax-m2.7',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.255, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.255, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...pinstripesChatModels];

export default allModels;
