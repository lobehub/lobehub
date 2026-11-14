import type { AIChatModelCard } from '../types/aiModel';

// https://inference.runanywhere.ai/v1/models
// https://www.runwally.com/pricing
const wallyChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4.1 Flash with a 1M context window, image input, tool calling and structured output. Thinks at high effort by default.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4.1-flash',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.006, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'GLM-5.3 Flash is the fast, low-cost GLM-5.3 model with a 1M context window, tool calling and structured output. Thinking cannot be turned off.',
    displayName: 'GLM-5.3 Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Kimi K3 from Moonshot AI with a 1M context window, image input, tool calling and structured output. Thinking is on by default.',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'kimi-k3',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.925, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 524_287,
    description: 'MiniMax M3 with a 512K context window, tool calling and structured output.',
    displayName: 'MiniMax M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'A faster-serving deployment of DeepSeek V4.1 Flash with a 1M context window, image input, tool calling and structured output.',
    displayName: 'DeepSeek V4.1 Flash (Fast)',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4.1-flash-fast',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.006, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'A faster-serving deployment of GLM-5.3 with a 1M context window, tool calling and structured output. Thinking cannot be turned off.',
    displayName: 'GLM-5.3 (Fast)',
    family: 'glm',
    generation: 'glm-5.3',
    id: 'glm-5.3-fast',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'A faster-serving deployment of DeepSeek V4 Pro with a 1M context window, tool calling and structured output. Thinking is off unless reasoning effort asks for it.',
    displayName: 'DeepSeek V4 Pro (Fast)',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro-fast',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.68, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.38, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'The July 31 release of DeepSeek V4 Flash with a 1M context window, tool calling and structured output. Thinking is off unless reasoning effort asks for it.',
    displayName: 'DeepSeek V4 Flash 0731',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash-0731',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.0093, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.293, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.88, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'The 2026-10-17 snapshot of DeepSeek V4.1 Flash with a 1M context window and tool calling.',
    displayName: 'DeepSeek V4.1 Flash 1017',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4.1-flash-1017',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.006, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.195, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...wallyChatModels];

export default allModels;
