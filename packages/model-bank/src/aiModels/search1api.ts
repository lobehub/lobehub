import type { AIChatModelCard } from '../types/aiModel';

const search1apiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek R1 70B standard edition with real-time web search, suited for up-to-date chat and text tasks.',
    displayName: 'DeepSeek R1 70B',
    enabled: true,
    id: 'deepseek-r1-70b-online',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek R1 full version with 671B parameters and real-time web search, offering stronger understanding and generation.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1-online',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek R1 70B fast edition with real-time web search, delivering quicker responses while maintaining performance.',
    displayName: 'DeepSeek R1 70B Fast',
    enabled: true,
    id: 'deepseek-r1-70b-fast-online',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek R1 fast full version with real-time web search, combining 671B-scale capability and faster response.',
    displayName: 'DeepSeek R1 Fast',
    enabled: true,
    id: 'deepseek-r1-fast-online',
    maxOutput: 16_384,
    type: 'chat',
  },
];

export const allModels = [...search1apiChatModels];

export default allModels;
