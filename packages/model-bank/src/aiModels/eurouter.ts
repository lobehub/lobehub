import { type AIChatModelCard } from '../types/aiModel';

const eurouterChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek R1 is a reasoning model that achieves performance comparable to OpenAI-o1 across math, code, and reasoning tasks.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi K2.5 is a powerful multilingual model with strong reasoning, vision, and tool-use capabilities.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Mistral Large 3 is a top-tier EU-native model excelling at multilingual tasks, code generation, and complex reasoning.',
    displayName: 'Mistral Large 3',
    enabled: true,
    id: 'mistral-large-latest',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'MiniMax M2.5 is a high-performance model with an extremely large context window, suitable for long-document analysis and complex tasks.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'minimax-m2.5',
    type: 'chat',
  },
];

export const allModels = [...eurouterChatModels];

export default allModels;
