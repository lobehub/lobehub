import type { AIChatModelCard } from '../../types/aiModel';

export const deepseekV4ChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4.1 Flash is the fast, low-cost member of the DeepSeek V4.1 family: a 1M-token context, tool calling, optional reasoning and image input at a fraction of the Pro price.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'deepseek/deepseek-v4.1-flash',
    maxOutput: 943_718,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.006, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.045, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-10',
    settings: { extendParams: ['enableReasoning'] },
    type: 'chat',
  },
];
