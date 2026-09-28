import type { AIChatModelCard } from '../types/aiModel';

// https://dev.meta.ai/docs/models
const metaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Meta's frontier reasoning model, trained for agentic workflows and optimized for competitive coding performance. Muse Spark 1.3 tracks context and prior results, works through messy or conflicting inputs, and asks for input when needed.",
    displayName: 'Muse Spark 1.3',
    enabled: true,
    family: 'muse',
    generation: 'muse-spark-1.3',
    id: 'muse-spark-1.3',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export const allModels = [...metaChatModels];

export default allModels;
