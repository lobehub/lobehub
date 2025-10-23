import { AIChatModelCard } from '../types/aiModel';

// https://groq.com/pricing/
// https://console.groq.com/docs/models

const groqChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 131_072,
    description:
      'Compound 是一个复合 AI 系统，由 GroqCloud 中已经支持的多个开放可用的模型提供支持，可以智能地、有选择地使用工具来回答用户查询。',
    displayName: 'Compound',
    enabled: true,
    id: 'groq/compound',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Compound-mini 是一个复合 AI 系统，由 GroqCloud 中已经支持的公开可用模型提供支持，可以智能地、有选择地使用工具来回答用户查询。',
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
      'OpenAI GPT-OSS 120B 是一款拥有 1200 亿参数的顶尖语言模型，内置浏览器搜索和代码执行功能，并具备推理能力。',
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
      'OpenAI GPT-OSS 20B 是一款拥有 200 亿参数的顶尖语言模型，内置浏览器搜索和代码执行功能，并具备推理能力。',
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
      'kimi-k2-0905-preview 模型上下文长度为 256k，具备更强的 Agentic Coding 能力、更突出的前端代码的美观度和实用性、以及更好的上下文理解能力。',
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
      'Llama 3.1 8B 是一款高效能模型，提供了快速的文本生成能力，非常适合需要大规模效率和成本效益的应用场景。',
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
      'Meta Llama 3.3 多语言大语言模型 ( LLM ) 是 70B（文本输入/文本输出）中的预训练和指令调整生成模型。 Llama 3.3 指令调整的纯文本模型针对多语言对话用例进行了优化，并且在常见行业基准上优于许多可用的开源和封闭式聊天模型。',
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
