import type { AIChatModelCard } from '../types/aiModel';

// https://internlm.intern-ai.org.cn/api/document

const internlmChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'By default, it points to our latest released Intern series model, currently set to intern-s2-preview.',
    displayName: 'Intern',
    family: 'intern',
    id: 'intern-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-22',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Our newly released 35B-A3B scientific multimodal reasoning model supports a 256K context window. Through task scaling and architectural optimization, it is specifically designed to enhance scientific discovery and general-purpose agent capabilities.',
    displayName: 'Intern-S2-Preview',
    enabled: true,
    family: 'intern',
    id: 'intern-s2-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-22',
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
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'We have launched our most advanced open-source multimodal reasoning model, currently the top-performing open-source multimodal large language model in terms of overall performance.',
    displayName: 'Intern-S1-Pro',
    enabled: true,
    family: 'intern',
    id: 'intern-s1-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-04',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'internal',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'The open-source multimodal reasoning model not only demonstrates strong general-purpose capabilities but also achieves state-of-the-art performance across a wide range of scientific tasks.',
    displayName: 'Intern-S1',
    enabled: true,
    family: 'intern',
    id: 'intern-s1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-26',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'A lightweight multimodal large model with strong scientific reasoning capabilities.',
    displayName: 'Intern-S1-Mini',
    enabled: true,
    family: 'intern',
    id: 'intern-s1-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-20',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'By default, it points to the latest model in the InternVL3.5 series, currently set to internvl3.5-241b-a28b.',
    displayName: 'InternVL3.5',
    family: 'internvl',
    id: 'internvl3.5-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Our newly released multimodal large model features enhanced image-and-text understanding and long-sequence image comprehension capabilities, achieving performance comparable to leading closed-source models.',
    displayName: 'InternVL3.5-241B-A28B',
    family: 'internvl',
    id: 'internvl3.5-241b-a28b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-28',
    type: 'chat',
  },
];

export const allModels = [...internlmChatModels];

export default allModels;
