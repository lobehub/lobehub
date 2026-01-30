import { AIChatModelCard } from '../types/aiModel';

const githubCopilotChatModels: AIChatModelCard[] = [
  // OpenAI Models
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 is the flagship model for complex tasks, ideal for cross-domain problem solving.',
    displayName: 'GPT-4.1',
    enabled: true,
    id: 'gpt-4.1',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o is the most advanced multimodal model, handling text and image inputs.',
    displayName: 'GPT-4o',
    enabled: true,
    id: 'gpt-4o',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini is a cost-effective solution for a wide range of text and image tasks.',
    displayName: 'GPT-4o mini',
    id: 'gpt-4o-mini',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'o1 is OpenAI reasoning model for complex tasks requiring broad knowledge.',
    displayName: 'o1',
    id: 'o1',
    maxOutput: 100_000,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini is the newest small reasoning model, delivering high intelligence at low cost.',
    displayName: 'o3-mini',
    id: 'o3-mini',
    maxOutput: 100_000,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o4-mini is the latest small o-series model, optimized for fast, efficient reasoning.',
    displayName: 'o4-mini',
    enabled: true,
    id: 'o4-mini',
    maxOutput: 16_384,
    type: 'chat',
  },

  // Anthropic Models
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 90_000,
    description: 'Claude 3.5 Sonnet excels at coding, writing, and complex reasoning.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'claude-3.5-sonnet',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'Claude 3.7 Sonnet is an upgraded version with extended context and capabilities.',
    displayName: 'Claude 3.7 Sonnet',
    id: 'claude-3.7-sonnet',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'Claude 3.7 Sonnet with extended thinking for complex reasoning tasks.',
    displayName: 'Claude 3.7 Sonnet (Thinking)',
    id: 'claude-3.7-sonnet-thought',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Sonnet 4 is the latest generation with improved performance across all tasks.',
    displayName: 'Claude Sonnet 4',
    enabled: true,
    id: 'claude-sonnet-4',
    maxOutput: 16_000,
    type: 'chat',
  },

  // Google Models
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'Gemini 2.0 Flash delivers fast, efficient multimodal understanding.',
    displayName: 'Gemini 2.0 Flash',
    enabled: true,
    id: 'gemini-2.0-flash-001',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'Gemini 2.5 Pro is the most capable Gemini model with advanced reasoning.',
    displayName: 'Gemini 2.5 Pro',
    id: 'gemini-2.5-pro',
    maxOutput: 64_000,
    type: 'chat',
  },
];

export const allModels = [...githubCopilotChatModels];

export default allModels;
