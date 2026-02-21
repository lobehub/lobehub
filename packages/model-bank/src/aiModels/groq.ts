import type { AIChatModelCard } from '../types/aiModel';

// https://groq.com/pricing/
// https://console.groq.com/docs/models

const groqChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 131_072,
    description:
      'Compound is a composite AI system powered by multiple publicly available models supported on GroqCloud, intelligently and selectively using tools to answer user queries.',
    displayName: 'Compound',
    enabled: true,
    id: 'groq/compound',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Compound-mini is a composite AI system powered by publicly available models supported on GroqCloud, intelligently and selectively using tools to answer user queries.',
    displayName: 'Compound Mini',
    id: 'groq/compound-mini',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'OpenAI GPT-OSS 120B is a top-tier language model with 120B parameters, featuring built-in browser search and code execution, plus reasoning capabilities.',
    displayName: 'GPT OSS 120B',
    id: 'openai/gpt-oss-120b',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'OpenAI GPT-OSS 20B is a top-tier language model with 20B parameters, featuring built-in browser search and code execution, plus reasoning capabilities.',
    displayName: 'GPT OSS 20B',
    id: 'openai/gpt-oss-20b',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The kimi-k2-0905-preview model supports a 256k context window, with stronger agentic coding, more polished and practical frontend code, and better context understanding.',
    displayName: 'Kimi K2 0905',
    enabled: true,
    id: 'moonshotai/kimi-k2-instruct-0905',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    displayName: 'Llama 4 Scout (17Bx16E)',
    enabled: true,
    id: 'meta-llama/llama-4-scout-17b-16e-instruct',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.34, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 4 Maverick (17Bx128E)',
    enabled: true,
    id: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Qwen3 32B',
    id: 'qwen/qwen3-32b',
    maxOutput: 40_960,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 8B is a high-efficiency model with fast text generation, ideal for large-scale, cost-efficient use cases.',
    displayName: 'Llama 3.1 8B Instant',
    id: 'llama-3.1-8b-instant',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Meta Llama 3.3 is a multilingual LLM with 70B parameters (text in/text out), offering pre-trained and instruction-tuned variants. The instruction-tuned text-only model is optimized for multilingual dialogue use cases and outperforms many available open and closed chat models on common industry benchmarks.',
    displayName: 'Llama 3.3 70B Versatile',
    id: 'llama-3.3-70b-versatile',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    displayName: 'Mistral Saba 24B',
    id: 'mistral-saba-24b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    displayName: 'Llama Guard 4 12B',
    id: 'meta-llama/llama-guard-4-12b',
    maxOutput: 1024,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 512,
    displayName: 'Llama Prompt Guard 2 22M',
    id: 'meta-llama/llama-prompt-guard-2-22m',
    maxOutput: 512,
    type: 'chat',
  },
  {
    contextWindowTokens: 512,
    displayName: 'Llama Prompt Guard 2 86M',
    id: 'meta-llama/llama-prompt-guard-2-86m',
    maxOutput: 512,
    type: 'chat',
  },
];

export const allModels = [...groqChatModels];

export default allModels;
