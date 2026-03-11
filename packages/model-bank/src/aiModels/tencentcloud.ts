import type { AIChatModelCard } from '../types/aiModel';

// https://cloud.tencent.com/document/product/1772/115969
const tencentCloudChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-R1 is a 671B-parameter model trained with reinforcement learning. Its reasoning process includes extensive reflection and verification, with chains of thought that can reach tens of thousands of words. The series excels in math, code, and complex logical reasoning tasks, and exposes the full reasoning process to users.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3-0324 is a 671B-parameter MoE model with standout strengths in programming and technical capability, context understanding, and long-text handling.',
    displayName: 'DeepSeek V3 0324',
    enabled: true,
    id: 'deepseek-v3-0324',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 is a 671B-parameter MoE model with strong performance in knowledge and math reasoning tasks.',
    displayName: 'DeepSeek V3',
    id: 'deepseek-v3',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...tencentCloudChatModels];

export default allModels;
