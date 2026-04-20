import type { AIChatModelCard } from '../../../types/aiModel';

// price: https://docs.z.ai/guides/overview/pricing
// ref: https://docs.z.ai/guides/llm/glm-5.1

export const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: false,
    },
    contextWindowTokens: 200_000,
    description:
      "Zai's latest flagship model, aligned with Claude Opus 4.6 on overall and coding capabilities. Excels at long-horizon tasks with autonomous work up to 8 hours, an ideal foundation for Autonomous Agents and long-horizon Coding Agents.",
    displayName: 'GLM-5.1',
    enabled: true,
    id: 'glm-5.1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Zai's new-generation flagship foundation model, designed for Agentic Engineering, capable of providing reliable productivity in complex system engineering and long-range Agent tasks.",
    displayName: 'GLM-5',
    enabled: true,
    id: 'glm-5',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];
