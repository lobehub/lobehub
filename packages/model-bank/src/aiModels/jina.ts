import type { AIChatModelCard } from '../types/aiModel';

const jinaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSearch combines web search, reading, and reasoning for thorough investigations. Think of it as an agent that takes your research task, performs broad searches with multiple iterations, and only then produces an answer. The process involves continuous research, reasoning, and multi-angle problem solving, fundamentally different from standard LLMs that answer from pretraining data or traditional RAG systems that rely on one-shot surface search.',
    displayName: 'Jina DeepSearch v1',
    enabled: true,
    id: 'jina-deepsearch-v1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'internal',
    },
    type: 'chat',
  },
];

export const allModels = [...jinaChatModels];

export default allModels;
