import type { AIChatModelCard } from '../types/aiModel';

const cohereChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Command A is our most capable model to date, excelling at tool use, agents, RAG, and multilingual scenarios. It has a 256K context window, runs on just two GPUs, and delivers 150% higher throughput than Command R+ 08-2024.',
    displayName: 'Command A 2503',
    enabled: true,
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
      'command-r-plus is an alias of command-r-plus-04-2024, so using command-r-plus in the API points to that model.',
    displayName: 'Command R+ 2404',
    id: 'command-r-plus-04-2024',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
    id: 'command-r-plus-08-2024',
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
    description:
      'command-r is an instruction-following chat model that performs language tasks with higher quality, improved reliability, and longer context than previous models. It supports complex workflows such as code generation, RAG, tool use, and agents.',
    displayName: 'Command R 2403',
    id: 'command-r-03-2024',
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
    description: 'command-r-08-2024 is an updated Command R model released in August 2024.',
    displayName: 'Command R 2408',
    enabled: true,
    id: 'command-r-08-2024',
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
      'Command R is an instruction-following chat model with higher quality, greater reliability, and a longer context window than earlier models. It supports complex workflows such as code generation, RAG, tool use, and agents.',
    displayName: 'Command R 2403',
    id: 'command-r-03-2024',
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
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'command-r7b-12-2024 is a small, efficient update released in December 2024. It excels at RAG, tool use, and agent tasks that require complex, multi-step reasoning.',
    displayName: 'Command R7B 2412',
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
    contextWindowTokens: 4000,
    description:
      'An instruction-following chat model that delivers higher quality and reliability on language tasks, with a longer context window than our base generative models.',
    displayName: 'Command',
    id: 'command',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
      'To shorten the gap between major releases, we offer nightly Command builds. For the Command series this is called command-nightly. It is the newest, most experimental (and potentially unstable) version, updated regularly without notice, so it is not recommended for production.',
    displayName: 'Command Nightly',
    id: 'command-nightly',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4000,
    description: 'A smaller, faster Command variant that is nearly as capable but faster.',
    displayName: 'Command Light',
    id: 'command-light',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4000,
    description:
      'To shorten the gap between major releases, we offer nightly Command builds. For the command-light series this is called command-light-nightly. It is the newest, most experimental (and potentially unstable) version, updated regularly without notice, so it is not recommended for production.',
    displayName: 'Command Light Nightly',
    id: 'command-light-nightly',
    maxOutput: 4000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 8000,
    description:
      'Aya Expanse is a high-performance 8B multilingual model that uses instruction tuning, data arbitrage, preference training, and model merging to rival monolingual models. It supports 23 languages.',
    displayName: 'Aya Expanse 8B',
    enabled: true,
    id: 'c4ai-aya-expanse-8b',
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
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Aya Vision is a state-of-the-art multimodal model that performs strongly on key language, text, and vision benchmarks. This 8B version focuses on low latency and strong performance.',
    displayName: 'Aya Vision 8B',
    enabled: true,
    id: 'c4ai-aya-vision-8b',
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
