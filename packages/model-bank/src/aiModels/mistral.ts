import { AIChatModelCard } from '../types/aiModel';

// https://docs.mistral.ai/getting-started/models/models_overview/
// https://mistral.ai/pricing#api-pricing

const mistralChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Mistral Large 3 是一款最先进的开放权重通用多模态模型，采用精细的混合专家架构。它具有41B活跃参数和675B总参数。',
    displayName: 'Mistral Large 3',
    enabled: true,
    id: 'mistral-large-2512',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: 'Mistral Medium 3 以 8 倍的成本提供最先进的性能，并从根本上简化了企业部署。',
    displayName: 'Mistral Medium 3.1',
    enabled: true,
    id: 'mistral-medium-2508',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: 'Magistral Medium 1.2 是Mistral AI于2025年9月发布的前沿级推理模型，具有视觉支持。',
    displayName: 'Magistral Medium 1.2',
    enabled: true,
    id: 'magistral-medium-2509',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Magistral Small 1.2 is an open-source small reasoning model from Mistral AI (Sep 2025) with vision support.',
    displayName: 'Magistral Small 1.2',
    id: 'magistral-small-2509',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Mistral Nemo is a 12B model co-developed with Nvidia, offering strong reasoning and coding performance with easy integration.',
    displayName: 'Mistral Nemo',
    id: 'open-mistral-nemo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: 'Mistral Small是成本效益高、快速且可靠的选项，适用于翻译、摘要和情感分析等用例。',
    displayName: 'Mistral Small 3.2',
    id: 'mistral-small-2506',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Mistral Large is the flagship model, strong in multilingual tasks, complex reasoning, and code generation—ideal for high-end applications.',
    displayName: 'Mistral Large 2.1',
    id: 'mistral-large-2411',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Codestral is our most advanced coding model; v2 (Jan 2025) targets low-latency, high-frequency tasks like FIM, code correction, and test generation.',
    displayName: 'Codestral 2508',
    id: 'codestral-2508',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Pixtral Large is a 124B-parameter open multimodal model built on Mistral Large 2, the second in our multimodal family with frontier-level image understanding.',
    displayName: 'Pixtral Large',
    id: 'pixtral-large-2411',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Pixtral is strong at chart/image understanding, document QA, multimodal reasoning, and instruction following. It ingests images at native resolution/aspect ratio and handles any number of images within a 128K context window.',
    displayName: 'Pixtral 12B',
    id: 'pixtral-12b-2409',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Ministral 3 3B 是 Ministral 3 系列中最小的、最有效的模型，提供强大的语言和视觉能力在一个紧凑的包中。专为边缘部署设计，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 3B',
    id: 'ministral-3b-2512',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 8B 是 Ministral 3 系列中的强大且有效的模型，提供一流的文本和视觉能力。专为边缘部署构建，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 8B',
    id: 'ministral-8b-2512',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 14B 是 Ministral 3 系列中最大的模型，提供最先进的性能和与其更大的 Mistral Small 3.2 24B 对应模型相当的性能。针对本地部署优化，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 14B',
    id: 'ministral-14b-2512',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    contextWindowTokens: 262_144,
    description:
      'Codestral Mamba is a Mamba 2 language model focused on code generation, supporting advanced coding and reasoning tasks.',
    displayName: 'Codestral Mamba',
    id: 'open-codestral-mamba',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...mistralChatModels];

export default allModels;
