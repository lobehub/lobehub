import type { AIChatModelCard } from '../types/aiModel';

// Eden AI is an OpenAI-compatible aggregator. Models use the `provider/model`
// naming scheme and can also be discovered live via the model fetcher.
// https://www.edenai.co/product/models
const edenaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Anthropic Claude Sonnet 4.5, a strong general-purpose and coding model, served through Eden AI.',
    displayName: 'Claude Sonnet 4.5',
    enabled: true,
    id: 'anthropic/claude-sonnet-4-5',
    maxOutput: 64_000,
    pricing: {
      currency: 'USD',
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
      structuredOutput: true,
    },
    contextWindowTokens: 200_000,
    description: 'Anthropic Claude Haiku 4.5, a fast and cost-effective model, served through Eden AI.',
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'anthropic/claude-haiku-4-5',
    maxOutput: 64_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 400_000,
    description: 'OpenAI GPT-5.1, served through Eden AI.',
    displayName: 'GPT-5.1',
    enabled: true,
    id: 'openai/gpt-5.1',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 400_000,
    description: 'OpenAI GPT-5.1 Codex, optimized for coding, served through Eden AI.',
    displayName: 'GPT-5.1 Codex',
    id: 'openai/gpt-5.1-codex',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description: 'Mistral Codestral, optimized for code generation, served through Eden AI.',
    displayName: 'Codestral',
    id: 'mistral/codestral-latest',
    maxOutput: 8192,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 128_000,
    description: 'DeepSeek V4 Pro, served through Eden AI.',
    displayName: 'DeepSeek V4 Pro',
    id: 'deepseek/deepseek-v4-pro',
    maxOutput: 32_768,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...edenaiChatModels];

export default allModels;
