import type { AIChatModelCard } from '../types/aiModel';

const avianChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.2 is a powerful MoE model with strong reasoning and coding capabilities.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek/deepseek-v3.2',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Kimi K2.5 is a versatile multimodal model supporting vision and text inputs, thinking and non-thinking modes, and both conversational and agent tasks.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'moonshotai/kimi-k2.5',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'GLM-5 is a next-generation foundation model from Zhipu AI with strong reasoning and instruction-following capabilities.',
    displayName: 'GLM-5',
    enabled: true,
    id: 'z-ai/glm-5',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.55, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiniMax M2.5 is a high-performance model with a 1M token context window and strong general-purpose language understanding.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'minimax/minimax-m2.5',
    maxOutput: 1_000_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...avianChatModels];

export default allModels;
