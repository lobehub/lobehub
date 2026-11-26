import type { AIChatModelCard } from '../types/aiModel';

// https://api.privatedeskai.com/models (live, no auth required)
const saggChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 400_000,
    description:
      "DeepSeek's fast reasoning/agentic/coding model, served through SAGG's failover-protected gateway over the Gonka decentralized inference network.",
    displayName: 'DeepSeek V4 Flash 0731',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    maxOutput: 16_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.03971, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.07941, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export default saggChatModels;
