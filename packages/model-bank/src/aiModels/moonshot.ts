import type { AIChatModelCard } from '../types/aiModel';

// https://platform.kimi.com/docs/pricing/chat
const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Kimi's latest and most capable model, delivering stronger long-horizon coding, instruction following, and self-correction while supporting text, image, and video inputs plus chat and agent tasks.",
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 6.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is Kimi\'s most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, "thinking" and "non-thinking" modes, and both conversational and agent tasks.',
    displayName: 'Kimi K2.5',
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'Moonshot V1 8K is optimized for short text generation with efficient performance, handling 8,192 tokens for short chats, notes, and quick content.',
    displayName: 'Moonshot V1 8K',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
      'Moonshot V1 32K supports 32,768 tokens for medium-length context, ideal for long documents and complex dialogues in content creation, reports, and chat systems.',
    displayName: 'Moonshot V1 32K',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Moonshot V1 128K provides ultra-long context for very long text generation, handling up to 128,000 tokens for research, academic, and large-document scenarios.',
    displayName: 'Moonshot V1 128K',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-128k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 8K Vision Preview',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-8k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 32K Vision Preview',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-32k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi vision models (including moonshot-v1-8k-vision-preview/moonshot-v1-32k-vision-preview/moonshot-v1-128k-vision-preview) can understand image content such as text, colors, and object shapes.',
    displayName: 'Moonshot V1 128K Vision Preview',
    family: 'kimi',
    generation: 'moonshot-v1',
    id: 'moonshot-v1-128k-vision-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    type: 'chat',
  },
];

export const allModels = [...moonshotChatModels];

export default allModels;
