import type { AIChatModelCard } from '../types/aiModel';

// ref: https://mizumi.co/docs/models
// Prices are Starter-tier list rates in USD per 1M tokens.
const mizumiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    description:
      'Latest flagship model served by Mizumi, built for the strongest reasoning, agentic coding, and the hardest tasks.',
    displayName: 'GPT-6.1 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6.1',
    id: 'gpt-6.1-sol',
    pricing: {
      units: [
        { name: 'textInput', rate: 5.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 32.4, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'GPT-6 flagship with next-gen reasoning at GPT-5.6 Sol price point.',
    displayName: 'GPT-6 Sol',
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-sol',
    pricing: {
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'Mid-tier GPT-6 model for strong everyday coding and reasoning.',
    displayName: 'GPT-6 Astra',
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-astra',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 13.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    description: 'Lightweight GPT-6 model for high-volume, latency-sensitive tasks.',
    displayName: 'GPT-6 Luna',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'gpt-6-luna',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.225, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.35, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'Always routes to the latest chat model, currently the GPT-6.1 generation.',
    displayName: 'GPT Chat Latest',
    family: 'gpt',
    id: 'gpt-chat-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 5.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 32.4, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Frontier flagship of the GPT-5.6 generation for the deepest reasoning, agentic coding, and hardest tasks.',
    displayName: 'GPT-5.6 Sol',
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-sol',
    pricing: {
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
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
    description: 'Flagship intelligence at a mid-tier price.',
    displayName: 'GPT-5.6 Terra',
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-terra',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    description: 'Efficient, low-cost model for everyday workloads.',
    displayName: 'GPT-4.1 Mini',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.36, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.44, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...mizumiChatModels];

export default allModels;
