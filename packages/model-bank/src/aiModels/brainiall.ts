import type { AIChatModelCard } from '../types/aiModel';

const brainiallChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    displayName: 'Claude Opus 4.6',
    enabled: true,
    id: 'claude-opus-4-6',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    id: 'claude-sonnet-4-6',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'claude-haiku-4-5',
    maxOutput: 8_192,
    organization: 'Anthropic',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1',
    maxOutput: 64_000,
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek V3',
    id: 'deepseek-v3',
    maxOutput: 64_000,
    organization: 'DeepSeek',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'Llama 3.3 70B',
    id: 'llama-3.3-70b',
    maxOutput: 4_096,
    organization: 'Meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 512_000,
    displayName: 'Llama 4 Scout',
    id: 'llama-4-scout',
    maxOutput: 16_384,
    organization: 'Meta',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 80B',
    id: 'qwen3-80b',
    organization: 'Qwen',
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
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Mistral Large 3',
    id: 'mistral-large-3',
    organization: 'Mistral',
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
    contextWindowTokens: 1_000_000,
    displayName: 'MiniMax M2',
    id: 'minimax-m2',
    organization: 'MiniMax',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 300_000,
    displayName: 'Amazon Nova Pro',
    id: 'nova-pro',
    organization: 'Amazon',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    displayName: 'Amazon Nova Micro',
    id: 'nova-micro',
    organization: 'Amazon',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...brainiallChatModels];

export default allModels;
