import type { AIChatModelCard } from '../types/aiModel';

const cohereChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      "Command A+ is Cohere's first Mixture of Experts model, combining vision input support, agentic, reasoning, and world-class translation capabilities into a single model. It supports 48 languages and can run on 1× B200 or 2× H100 GPUs.",
    displayName: 'Command A+ 2605',
    enabled: true,
    family: 'command',
    id: 'command-a-plus-05-2026',
    maxOutput: 64_000,
    releasedAt: '2026-05-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Command A is our most capable model to date, excelling at tool use, agents, RAG, and multilingual scenarios. It has a 256K context window, runs on just two GPUs, and delivers 150% higher throughput than Command R+ 08-2024.',
    displayName: 'Command A 2503',
    enabled: true,
    family: 'command',
    id: 'command-a-03-2025',
    maxOutput: 8000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
      'Command R+ is an instruction-following chat model with higher quality, greater reliability, and a longer context window than previous models. It is best for complex RAG workflows and multi-step tool use.',
    displayName: 'Command R+ 2408',
    enabled: true,
    family: 'command',
    id: 'command-r-plus-08-2024',
    knowledgeCutoff: '2023-02',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'command-r-08-2024 is an updated Command R model released in August 2024.',
    displayName: 'Command R 2408',
    enabled: true,
    family: 'command',
    id: 'command-r-08-2024',
    knowledgeCutoff: '2023-02',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
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
      'command-r7b-12-2024 is a small, efficient update released in December 2024. It excels at RAG, tool use, and agent tasks that require complex, multi-step reasoning.',
    displayName: 'Command R7B 2412',
    family: 'command',
    id: 'command-r7b-12-2024',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.0375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Aya Expanse is a high-performance 32B multilingual model that uses instruction tuning, data arbitrage, preference training, and model merging to rival monolingual models. It supports 23 languages.',
    displayName: 'Aya Expanse 32B',
    enabled: true,
    family: 'aya',
    id: 'c4ai-aya-expanse-32b',
    maxOutput: 4000,
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
      vision: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Aya Vision is a state-of-the-art multimodal model that performs strongly on key language, text, and vision benchmarks. It supports 23 languages. This 32B version focuses on top-tier multilingual performance.',
    displayName: 'Aya Vision 32B',
    enabled: true,
    family: 'aya',
    id: 'c4ai-aya-vision-32b',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...cohereChatModels];

export default allModels;
