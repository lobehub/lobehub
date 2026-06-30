import { type AIChatModelCard } from '../types/aiModel';

const cerebrasModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'This model excels at multimodal reasoning across screenshots, documents, diagrams, and design assets. Ideal for visual agentic workflows, image-aware copilots, and teams migrating from closed multimodal APIs to an open model.',
    displayName: 'Gemma 4 31B',
    enabled: true,
    family: 'gemma',
    generation: 'gemma-4',
    id: 'gemma-4-31b',
    maxOutput: 40_960,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.49, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'GPT OSS 120B',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss-120b',
    knowledgeCutoff: '2024-06',
    maxOutput: 40_960,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
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
      "GLM-4.7 is Zhipu's new generation flagship model with 355B total parameters and 32B active parameters, fully upgraded in general dialogue, reasoning, and agent capabilities. GLM-4.7 enhances Interleaved Thinking and introduces Preserved Thinking and Turn-level Thinking.",
    displayName: 'GLM-4.7',
    family: 'glm',
    generation: 'glm-4.7',
    id: 'zai-glm-4.7',
    maxOutput: 40_960,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-22',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
];

export const allModels = [...cerebrasModels];

export default allModels;
