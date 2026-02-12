import type { AIChatModelCard } from '../types/aiModel';

const ai360ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 8000,
    description:
      '360zhinao2-o1 builds chain-of-thought via tree search with a reflection mechanism and RL training, enabling self-reflection and self-correction.',
    displayName: '360Zhinao2 o1',
    enabled: true,
    id: '360zhinao2-o1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 8000,
    description:
      '360gpt2-o1 builds chain-of-thought via tree search with a reflection mechanism and RL training, enabling self-reflection and self-correction.',
    displayName: '360GPT2 o1',
    id: '360gpt2-o1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 8000,
    description:
      'The flagship 100B-class model in the 360 Zhinao series, suitable for complex tasks across domains.',
    displayName: '360GPT2 Pro',
    enabled: true,
    id: '360gpt2-pro',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 8000,
    description:
      'The flagship 100B-class model in the 360 Zhinao series, suitable for complex tasks across domains.',
    displayName: '360GPT Pro',
    id: '360gpt-pro',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_000,
    description:
      'A translation-specialized model, deeply fine-tuned for leading translation quality.',
    displayName: '360GPT Pro Trans',
    id: '360gpt-pro-trans',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 7000,
    description:
      'A 10B-class model balancing performance and quality, suited for performance/cost-sensitive scenarios.',
    displayName: '360GPT Turbo',
    enabled: true,
    id: '360gpt-turbo',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      '360-deployed DeepSeek-R1 uses large-scale RL in post-training to greatly boost reasoning with minimal labels. It matches OpenAI o1 on math, code, and natural language reasoning tasks.',
    displayName: 'DeepSeek R1',
    id: '360/deepseek-r1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...ai360ChatModels];

export default allModels;
