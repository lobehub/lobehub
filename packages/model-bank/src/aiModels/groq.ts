import type { AIChatModelCard } from '../types/aiModel';

// https://groq.com/pricing/
// https://console.groq.com/docs/models

const groqChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 131_072,
    description:
      'Compound is a composite AI system powered by multiple publicly available models supported on GroqCloud, intelligently and selectively using tools to answer user queries.',
    displayName: 'Compound',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3.6 27B is an open-source dense model with strong performance in reasoning, coding, and general capabilities. It supports thinking mode by default, offering balanced performance and efficiency.',
    displayName: 'Qwen3.6 27B',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen/qwen3.6-27b',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-23',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 196_608,
    description:
      'MiniMax M2.7 is a 229B-parameter MoE model (~10B active) built for agentic workflows and real-world software engineering. It interleaves thinking with actions across multi-step tasks and is available on Groq for Enterprise customers.',
    displayName: 'MiniMax M2.7',
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimaxai/minimax-m2.7',
    maxOutput: 131_072,
    releasedAt: '2026-03-18',
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
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'openai/gpt-oss-120b',
    knowledgeCutoff: '2024-06',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-06',
    settings: {
      extendParams: ['reasoningEffort'],
    },
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
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'openai/gpt-oss-20b',
    knowledgeCutoff: '2024-06',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-06',
    settings: {
      extendParams: ['reasoningEffort'],
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
    family: 'llama',
    generation: 'llama-3.1',
    id: 'llama-3.1-8b-instant',
    knowledgeCutoff: '2023-12',
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
    family: 'llama',
    generation: 'llama-3.3',
    id: 'llama-3.3-70b-versatile',
    knowledgeCutoff: '2023-12',
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
    contextWindowTokens: 512,
    displayName: 'Llama Prompt Guard 2 22M',
    family: 'llama',
    id: 'meta-llama/llama-prompt-guard-2-22m',
    maxOutput: 512,
    type: 'chat',
  },
  {
    contextWindowTokens: 512,
    displayName: 'Llama Prompt Guard 2 86M',
    family: 'llama',
    id: 'meta-llama/llama-prompt-guard-2-86m',
    maxOutput: 512,
    type: 'chat',
  },
];

export const allModels = [...groqChatModels];

export default allModels;
