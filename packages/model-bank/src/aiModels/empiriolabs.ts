import type { AIChatModelCard } from '../types/aiModel';

// https://empiriolabs.ai/models
const empiriolabsChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max is a flagship text model for coding, productivity, long-running agents, deep thinking, and tool use.',
    displayName: 'Qwen3.7 Max',
    id: 'qwen3-7-max',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Cost-effective Qwen3.7 vision-language model for text, image, video, coding, tool use, GUI understanding, and 1M-context workflows.',
    displayName: 'Qwen3.7 Plus',
    id: 'qwen3-7-plus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 flagship MoE LLM with 1.6T total / 49B active parameters and native 1M context.',
    displayName: 'DeepSeek V4 Pro',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Lightweight DeepSeek V4 MoE model with 284B total / 13B active parameters and native 1M context.',
    displayName: 'DeepSeek V4 Flash',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_000,
    description:
      'Long-context Zhipu AI reasoning model with 202K context, 128K output, and tool use.',
    displayName: 'GLM-5.1',
    id: 'glm-5-1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.825, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.301, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Kimi K2.6 is a Moonshot multimodal reasoning model with 256K context and strong agentic skills.',
    displayName: 'Kimi K2.6',
    id: 'kimi-k2-6',
    maxOutput: 16_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8939, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.7131, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 524_288,
    description:
      'MiniMax M3 is a multimodal reasoning model for coding, agents, and long-context analysis with text, image, and video input.',
    displayName: 'MiniMax M3',
    id: 'minimax-m3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.225, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Gemma 4 26B A4B is a Google open multimodal model with 256K context and text, image, and video input.',
    displayName: 'Gemma 4 26B A4B',
    id: 'gemma-4-26b-a4b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...empiriolabsChatModels];

export default allModels;
