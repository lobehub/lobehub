import type { AIChatModelCard } from '../types/aiModel';

const zerooneChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 16_384,
    description: 'A latest high-performance model with faster inference and high-quality output.',
    displayName: 'Yi Lightning',
    enabled: true,
    id: 'yi-lightning',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_384,
    description:
      'A vision model for complex tasks with strong multi-image understanding and analysis.',
    displayName: 'Yi Vision V2',
    enabled: true,
    id: 'yi-vision-v2',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: 'A compact, fast model with strengthened math and coding capabilities.',
    displayName: 'Yi Spark',
    id: 'yi-spark',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'A tuned mid-size model with balanced capability and value, optimized for instruction following.',
    displayName: 'Yi Medium',
    id: 'yi-medium',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 200_000,
    description: 'A 200K long-context model for deep long-form understanding and generation.',
    displayName: 'Yi Medium 200K',
    id: 'yi-medium-200k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Exceptional value and performance, tuned for a strong balance of quality, speed, and cost.',
    displayName: 'Yi Large Turbo',
    id: 'yi-large-turbo',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'An advanced service based on yi-large, combining retrieval and generation for precise answers with real-time web search.',
    displayName: 'Yi Large RAG',
    id: 'yi-large-rag',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Built on yi-large with enhanced tool-calling, suited for agent and workflow scenarios.',
    displayName: 'Yi Large FC',
    id: 'yi-large-fc',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'A new 100B-parameter model with strong Q&A and text generation.',
    displayName: 'Yi Large',
    id: 'yi-large',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_384,
    description: 'A vision model for complex tasks with strong image understanding and analysis.',
    displayName: 'Yi Vision',
    id: 'yi-vision',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: 'An early version; yi-large (newer) is recommended.',
    displayName: 'Yi Large Preview',
    id: 'yi-large-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: 'A lightweight version; yi-lightning is recommended.',
    displayName: 'Yi Lightning Lite',
    id: 'yi-lightning-lite',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...zerooneChatModels];

export default allModels;
