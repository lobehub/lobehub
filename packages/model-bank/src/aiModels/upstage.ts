import type { AIChatModelCard } from '../types/aiModel';

// https://console.upstage.ai/docs/capabilities/chat

const upstageChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 32_768,
    description:
      'Solar Pro is a high-intelligence LLM from Upstage, focused on instruction following on a single GPU, with IFEval scores above 80. It currently supports English; the full release was planned for November 2024 with expanded language support and longer context.',
    displayName: 'Solar Pro',
    enabled: true,
    id: 'solar-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Solar Mini is a compact LLM that outperforms GPT-3.5, with strong multilingual capability supporting English and Korean, offering an efficient small-footprint solution.',
    displayName: 'Solar Mini',
    enabled: true,
    id: 'solar-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-23',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Solar Mini (Ja) extends Solar Mini with a focus on Japanese while maintaining efficient, strong performance in English and Korean.',
    displayName: 'Solar Mini (Ja)',
    id: 'solar-mini-ja', // deprecated on 2025-04-10
    releasedAt: '2025-01-23',
    type: 'chat',
  },
];

export const allModels = [...upstageChatModels];

export default allModels;
