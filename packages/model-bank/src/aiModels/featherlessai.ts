import { AIChatModelCard } from '../types/aiModel';

const featherlessaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description: 'DeepSeek R1——DeepSeek 套件中更大更智能的模型——被蒸馏到 Llama 70B 架构中。基于基准测试和人工评估，该模型比原始 Llama 70B 更智能，尤其在需要数学和事实精确性的任务上表现出色。',
    displayName: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 32_000,
    description: 'OpenAI 的 120B 模型，基于 GPT-3.5 架构，具有强大的语言理解、推理和生成能力。',
    displayName: 'openai/gpt-oss-120b',
    enabled: true,
    id: 'openai/gpt-oss-120b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 16_000,
    description: 'Qwen QwQ 是由 Qwen 团队开发的实验研究模型，专注于提升AI推理能力。',
    displayName: 'QwQ 32B',
    enabled: true,
    id: 'Qwen/QwQ-32B',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: '面向中文和英文的 LLM，针对语言、编程、数学、推理等领域。',
    displayName: 'Qwen2.5 72B Instruct',
    enabled: true,
    id: 'Qwen/Qwen2.5-72B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: '高级 LLM，支持代码生成、推理和修复，涵盖主流编程语言。',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    enabled: true,
    id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Qwen 是 Qwen 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'Qwen/Qwen2.5-32B-Instruct',
    enabled: true,
    id: 'Qwen/Qwen2.5-32B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 32_000,
    description: 'DeepSeek V3 是 DeepSeek 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'deepseek-ai/DeepSeek-V3-0324',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3-0324',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 32_000,
    description: 'DeepSeek R1 是 DeepSeek 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'deepseek-ai/DeepSeek-R1-0528',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-R1-0528',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Mistral 是 Mistral AI 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'mistralai/Mistral-Small-3.1-24B-Instruct-2503',
    enabled: true,
    id: 'mistralai/Mistral-Small-3.1-24B-Instruct-2503',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Mistral 是 Mistral AI 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'mistralai/Devstral-Small-2505',
    enabled: true,
    id: 'mistralai/Devstral-Small-2505',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Mistral 是 Mistral AI 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'mistralai/Magistral-Small-2506',
    enabled: true,
    id: 'mistralai/Magistral-Small-2506',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Qwen 是 Qwen 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'Qwen/Qwen3-32B',
    enabled: true,
    id: 'Qwen/Qwen3-32B',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Llama 是 Meta 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'meta-llama/Llama-3.3-70B-Instruct',
    enabled: true,
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 16_000,
    description: 'Meta-Llama 是 Meta 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    enabled: true,
    id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  },
  {
    contextWindowTokens: 32_000,
    description: 'Kimi-K2 Instruct 是 Kimi 团队开发的最新一代大模型，具有强大的语言理解、推理和生成能力。',
    displayName: 'moonshotai/Kimi-K2-Instruct-0905',
    enabled: true,
    id: 'moonshotai/Kimi-K2-Instruct-0905',
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat'
  }
]

export const allModels = [...featherlessaiChatModels];

export default allModels;