import type { AIChatModelCard } from '../types/aiModel';

const tokendosChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.7 Sonnet is Anthropic’s most intelligent model, combining state-of-the-art hybrid reasoning with fast response times and deep coding capabilities.',
    displayName: 'Claude 3.7 Sonnet',
    enabled: true,
    family: 'claude',
    generation: 'claude-3.7',
    id: 'claude-3-7-sonnet-20250219',
    maxOutput: 64_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Sonnet delivers exceptional intelligence, reasoning and coding capabilities with balanced latency and cost.',
    displayName: 'Claude 3.5 Sonnet',
    enabled: true,
    family: 'claude',
    generation: 'claude-3.5',
    id: 'claude-3-5-sonnet-20241022',
    maxOutput: 8192,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT-4o is OpenAI’s versatile flagship multimodal model for text, reasoning, and visual understanding.',
    displayName: 'GPT-4o',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-4o',
    id: 'gpt-4o',
    maxOutput: 16_384,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description:
      'DeepSeek-R1 achieves state-of-the-art reasoning, mathematical problem solving, and complex logic reasoning.',
    displayName: 'DeepSeek R1',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-r1',
    id: 'deepseek-reasoner',
    maxOutput: 8192,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export default tokendosChatModels;
