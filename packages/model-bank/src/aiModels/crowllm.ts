import type { AIChatModelCard } from '../types/aiModel';

// CrowLLM gateway rates, USD per million tokens (https://crowllm.com/api/pricing).
const crowllmChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek V4 Flash through the CrowLLM gateway, billed at the gateway rate.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    id: 'deepseek-v4-flash',
    maxOutput: 16_384,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.014, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 200_000,
    description: 'GLM 5.3 (Zhipu) through the CrowLLM gateway.',
    displayName: 'GLM 5.3',
    enabled: true,
    family: 'glm',
    id: 'glm-5.3',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.149395, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.5976, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.09155, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 256_000,
    description: 'Kimi K3 (Moonshot) through the CrowLLM gateway.',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    id: 'kimi-k3',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.223, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.49, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12.99, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'Claude Opus 4.7 (Anthropic) through the CrowLLM gateway.',
    displayName: 'Claude Opus 4.7',
    enabled: true,
    family: 'claude',
    id: 'claude-opus-4-7',
    maxOutput: 32_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Gemini 3.7 Flash (Google) through the CrowLLM gateway.',
    displayName: 'Gemini 3.7 Flash',
    enabled: true,
    family: 'gemini',
    id: 'gemini-3.7-flash',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 256_000,
    description: 'Grok 4.7 on the zero-rated `:free` shelf of the CrowLLM gateway.',
    displayName: 'Grok 4.7 (free)',
    enabled: true,
    family: 'grok',
    id: 'grok-4.7:free',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...crowllmChatModels];

export default allModels;
