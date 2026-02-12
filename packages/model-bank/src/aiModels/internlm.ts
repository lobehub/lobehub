import type { AIChatModelCard } from '../types/aiModel';

// https://internlm.intern-ai.org.cn/api/document

const internlmChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Our latest model series with excellent reasoning performance, leading open models in its size class. Defaults to the latest InternLM3 series (currently internlm3-8b-instruct).',
    displayName: 'InternLM3',
    enabled: true,
    id: 'internlm3-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Legacy models still maintained with excellent, stable performance after many iterations. Available in 7B and 20B sizes, supporting 1M context and stronger instruction following and tool use. Defaults to the latest InternLM2.5 series (currently internlm2.5-20b-chat).',
    displayName: 'InternLM2.5',
    id: 'internlm2.5-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Our latest multimodal model with stronger image-text understanding and long-sequence image comprehension, comparable to top closed models. Defaults to the latest InternVL series (currently internvl3-78b).',
    displayName: 'InternVL3',
    enabled: true,
    id: 'internvl3-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'InternVL2.5 is still maintained with strong, stable performance. Defaults to the latest InternVL2.5 series (currently internvl2.5-78b).',
    displayName: 'InternVL2.5',
    id: 'internvl2.5-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...internlmChatModels];

export default allModels;
