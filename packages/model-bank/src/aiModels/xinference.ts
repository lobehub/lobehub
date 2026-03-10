import type { AIChatModelCard } from '../types/aiModel';

const xinferenceChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3 is a powerful MoE model with 671B total parameters and 37B active per token.',
    displayName: 'DeepSeek V3',
    enabled: true,
    id: 'deepseek-v3',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 uses cold-start data before RL and performs comparably to OpenAI-o1 on math, coding, and reasoning.',
    displayName: 'DeepSeek R1',
    enabled: true,
    id: 'deepseek-r1',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description: 'deepseek-r1-distill-llama is distilled from DeepSeek-R1 on Llama.',
    displayName: 'DeepSeek R1 Distill Llama',
    enabled: true,
    id: 'deepseek-r1-distill-llama',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description: 'deepseek-r1-distill-qwen is distilled from DeepSeek-R1 on Qwen.',
    displayName: 'DeepSeek R1 Distill Qwen',
    enabled: true,
    id: 'deepseek-r1-distill-qwen',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'QwQ is a reasoning model in the Qwen family. Compared with standard instruction-tuned models, it brings thinking and reasoning that significantly boost downstream performance, especially on complex problems. QwQ-32B is a mid-sized reasoning model that rivals top reasoning models like DeepSeek-R1 and o1-mini.',
    displayName: 'QwQ 32B',
    enabled: true,
    id: 'qwq-32b',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'QVQ-72B-Preview is an experimental research model from Qwen focused on improving visual reasoning.',
    displayName: 'QVQ 72B Preview',
    enabled: true,
    id: 'qvq-72b-preview',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is the latest Qwen LLM series, with base and instruction-tuned models ranging from 0.5B to 72B parameters.',
    displayName: 'Qwen2.5 Instruct',
    enabled: true,
    id: 'qwen2.5-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder is the latest code-focused LLM in the Qwen family (formerly CodeQwen).',
    displayName: 'Qwen2.5 Coder Instruct',
    enabled: true,
    id: 'qwen2.5-coder-instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'Qwen2.5-VL is the latest vision-language model in the Qwen family.',
    displayName: 'Qwen2.5 VL Instruct',
    enabled: true,
    id: 'qwen2.5-vl-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 1_024_000,
    description:
      'Mistral-Nemo-Instruct-2407 is the instruction-tuned version of Mistral-Nemo-Base-2407.',
    displayName: 'Mistral Nemo Instruct',
    enabled: true,
    id: 'mistral-nemo-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral-Large-Instruct-2407 is an advanced dense LLM with 123B parameters and state-of-the-art reasoning, knowledge, and coding.',
    displayName: 'Mistral Large Instruct',
    enabled: true,
    id: 'mistral-large-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.3 instruction-tuned model is optimized for chat and beats many open chat models on common industry benchmarks.',
    displayName: 'Llama 3.3 Instruct',
    enabled: true,
    id: 'llama-3.3-instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 163_840,
    description:
      'Llama 3.2-Vision instruction-tuned model is optimized for visual recognition, image reasoning, captioning, and general image Q&A.',
    displayName: 'Llama 3.2 Vision Instruct',
    enabled: true,
    id: 'llama-3.2-vision-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned model is optimized for chat and beats many open chat models on common industry benchmarks.',
    displayName: 'Llama 3.1 Instruct',
    enabled: true,
    id: 'llama-3.1-instruct',
    type: 'chat',
  },
];

export const allModels = [...xinferenceChatModels];

export default allModels;
