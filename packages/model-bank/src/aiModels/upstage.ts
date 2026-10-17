import type { AIChatModelCard } from '../types/aiModel';

// https://console.upstage.ai/docs/capabilities/chat
// https://console.upstage.ai/docs/models/history

const upstageChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 512_000,
    description:
      'Solar Pro 4 is the latest Solar Pro model from Upstage, with a 512K context window, tool calling, structured outputs (JSON schema), and adjustable reasoning via reasoning_effort. It handles English, Korean, and Japanese text.',
    displayName: 'Solar Pro 4',
    enabled: true,
    family: 'solar',
    id: 'solar-pro4',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 512_000,
    description:
      'Solar Mini 4 is a compact, cost-efficient Solar model from Upstage, with a 512K context window, tool calling, structured outputs (JSON schema), and adjustable reasoning via reasoning_effort.',
    displayName: 'Solar Mini 4',
    enabled: true,
    family: 'solar',
    id: 'solar-mini4',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-22',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Solar Pro is a high-intelligence LLM from Upstage, focused on instruction following on a single GPU, with IFEval scores above 80. It currently supports English; the full release was planned for November 2024 with expanded language support and longer context.',
    displayName: 'Solar Pro',
    family: 'solar',
    id: 'solar-pro', // superseded by solar-pro4; Solar Pro 2/3 are deprecated on 2026-10-30
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
    family: 'solar',
    id: 'solar-mini', // deprecated on 2026-10-30, replaced by solar-mini4
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
