import type { AIChatModelCard } from '../types/aiModel';

// https://docs.mistral.ai/getting-started/models/models_overview/
// https://mistral.ai/pricing#api-pricing

const mistralChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Mistral Medium 3.5 is a frontier-class multimodal model optimized for agentic and coding use cases, released as open weights under a Modified MIT license.',
    displayName: 'Mistral Medium 3.5',
    enabled: true,
    family: 'mistral',
    id: 'mistral-medium-3.5',
    knowledgeCutoff: '2024-11',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-30',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Devstral Small 2 excels at using tools to explore code bases, edit multiple files, and power software engineering agents.',
    displayName: 'Devstral Small 2',
    family: 'devstral',
    id: 'labs-devstral-small-2512',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      "Mistral's powerful hybrid model unifying instruct, reasoning, and coding capabilities in a single model. 119B parameters with 6.5B active.",
    displayName: 'Mistral Small 4',
    family: 'mistral',
    id: 'mistral-small-2603',
    knowledgeCutoff: '2024-11',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-16',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Mistral Large 3, is a state-of-the-art, open-weight, general-purpose multimodal model with a granular Mixture-of-Experts architecture. It features 41B active parameters and 675B total parameters.',
    displayName: 'Mistral Large 3',
    enabled: true,
    family: 'mistral',
    id: 'mistral-large-2512',
    knowledgeCutoff: '2023-10',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-02',
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
    family: 'codestral',
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
    },
    contextWindowTokens: 131_072,
    description: 'Ministral 3B is Mistral’s top-tier edge model.',
    displayName: 'Ministral 3B',
    family: 'ministral',
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
    family: 'ministral',
    id: 'ministral-8b-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...mistralChatModels];

export default allModels;
