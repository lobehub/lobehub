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
];

export const allModels = [...cerebrasModels];

export default allModels;
