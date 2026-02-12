import type { AIChatModelCard } from '../types/aiModel';

// https://docs.mistral.ai/getting-started/models/models_overview/
// https://mistral.ai/pricing#api-pricing

const mistralChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Medium 3 delivers state-of-the-art performance at 8× lower cost and simplifies enterprise deployment.',
    displayName: 'Mistral Medium 3.1',
    enabled: true,
    id: 'mistral-medium-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Magistral Medium 1.2 is a frontier reasoning model from Mistral AI (Sep 2025) with vision support.',
    displayName: 'Magistral Medium 1.2',
    enabled: true,
    id: 'magistral-medium-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Magistral Small 1.2 is an open-source small reasoning model from Mistral AI (Sep 2025) with vision support.',
    displayName: 'Magistral Small 1.2',
    id: 'magistral-small-2509',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Nemo is a 12B model co-developed with Nvidia, offering strong reasoning and coding performance with easy integration.',
    displayName: 'Mistral Nemo',
    id: 'open-mistral-nemo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Small is a cost-effective, fast, and reliable option for translation, summarization, and sentiment analysis.',
    displayName: 'Mistral Small 3.2',
    id: 'mistral-small-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Mistral Large is the flagship model, strong in multilingual tasks, complex reasoning, and code generation—ideal for high-end applications.',
    displayName: 'Mistral Large 2.1',
    id: 'mistral-large-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Codestral is our most advanced coding model; v2 (Jan 2025) targets low-latency, high-frequency tasks like FIM, code correction, and test generation.',
    displayName: 'Codestral 2508',
    id: 'codestral-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-30',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Pixtral Large is a 124B-parameter open multimodal model built on Mistral Large 2, the second in our multimodal family with frontier-level image understanding.',
    displayName: 'Pixtral Large',
    id: 'pixtral-large-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Pixtral is strong at chart/image understanding, document QA, multimodal reasoning, and instruction following. It ingests images at native resolution/aspect ratio and handles any number of images within a 128K context window.',
    displayName: 'Pixtral 12B',
    id: 'pixtral-12b-2409',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Ministral 3B is Mistral’s top-tier edge model.',
    displayName: 'Ministral 3B',
    id: 'ministral-3b-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Ministral 8B is a highly cost-effective edge model from Mistral.',
    displayName: 'Ministral 8B',
    id: 'ministral-8b-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      'Codestral Mamba is a Mamba 2 language model focused on code generation, supporting advanced coding and reasoning tasks.',
    displayName: 'Codestral Mamba',
    id: 'open-codestral-mamba',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...mistralChatModels];

export default allModels;
