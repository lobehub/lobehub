import type { AIChatModelCard } from '../types/aiModel';

// Curated flagship models. The full catalog is fetched live via the model fetcher.
// Browse all models at https://tokenmix.ai/models
const tokenmixChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro is the flagship of the DeepSeek V4 family, offering hybrid thinking and a 1M context window for complex reasoning and agent workflows.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek/deepseek-v4-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.84, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash is the cost-efficient V4 variant with a 1M context window, tuned for high-throughput, latency-sensitive workloads.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek/deepseek-v4-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek V3.2 is a hybrid reasoning model balancing strong tool use and reasoning with competitive pricing.',
    displayName: 'DeepSeek V3.2',
    id: 'deepseek/deepseek-v3.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max is the high-end reasoning model in the Qwen3 series, built for multilingual reasoning and tool integration.',
    displayName: 'Qwen3 Max',
    enabled: true,
    id: 'qwen/qwen3-max',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.33, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.31, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 256_000,
    description:
      'Kimi K2.6 is Moonshot AI’s multimodal model with strong reasoning, vision, and tool-calling capability.',
    displayName: 'Kimi K2.6',
    enabled: true,
    id: 'moonshot/kimi-k2.6',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.86, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.57, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2 Thinking is Moonshot AI’s reasoning model optimized for deep, multi-step reasoning and agent tasks.',
    displayName: 'Kimi K2 Thinking',
    id: 'moonshot/kimi-k2-thinking',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.53, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'MiniMax M2.5 is a high-value model that performs strongly on coding and agent tasks across many engineering scenarios.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'minimax/minimax-m2.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM 4.7 is Zhipu AI’s flagship hybrid reasoning model, optimized for engineering, agent, and long-context tasks.',
    displayName: 'GLM 4.7',
    id: 'zhipu/glm-4.7',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...tokenmixChatModels];

export default allModels;
