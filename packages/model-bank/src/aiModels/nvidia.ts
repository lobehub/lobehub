import type { AIChatModelCard } from '../types/aiModel';

const nvidiaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'MiniMax-M2 is a compact, fast, cost-effective MoE model (230B total, 10B active) built for top-tier coding and agent performance while retaining strong general intelligence. It excels at multi-file edits, code-run-fix loops, test validation, and complex toolchains.',
    displayName: 'MiniMax-M2',
    enabled: true,
    id: 'minimaxai/minimax-m2',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.1 is a next-gen reasoning model with stronger complex reasoning and chain-of-thought for deep analysis tasks.',
    displayName: 'DeepSeek V3.1 Terminus',
    enabled: true,
    id: 'deepseek-ai/deepseek-v3.1-terminus',
    maxOutput: 16_384,
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
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.1 is a next-gen reasoning model with stronger complex reasoning and chain-of-thought for deep analysis tasks.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-ai/deepseek-v3.1',
    maxOutput: 16_384,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'An advanced LLM strong at reasoning, math, common sense, and function calling.',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta/llama-3.3-70b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'A cutting-edge small language model with strong understanding, reasoning, and text generation.',
    displayName: 'Llama 3.2 1B Instruct',
    id: 'meta/llama-3.2-1b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'A cutting-edge small language model with strong understanding, reasoning, and text generation.',
    displayName: 'Llama 3.2 3B Instruct',
    id: 'meta/llama-3.2-3b-instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A frontier vision-language model that excels at high-quality reasoning from images.',
    displayName: 'Llama 3.2 11B Vision Instruct',
    id: 'meta/llama-3.2-11b-vision-instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A frontier vision-language model that excels at high-quality reasoning from images.',
    displayName: 'Llama 3.2 90B Vision Instruct',
    id: 'meta/llama-3.2-90b-vision-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A cutting-edge model with strong language understanding, reasoning, and text generation.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta/llama-3.1-8b-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Built for complex dialogue with excellent context understanding, reasoning, and text generation.',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'meta/llama-3.1-70b-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'An advanced LLM supporting synthetic data generation, knowledge distillation, and reasoning for chatbots, coding, and domain tasks.',
    displayName: 'Llama 3.1 405B Instruct',
    id: 'meta/llama-3.1-405b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'A distinctive language model delivering exceptional accuracy and efficiency.',
    displayName: 'Llama 3.1 Nemotron 51B Instruct',
    id: 'nvidia/llama-3.1-nemotron-51b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Llama-3.1-Nemotron-70B-Instruct is a custom NVIDIA model designed to improve the helpfulness of LLM responses.',
    displayName: 'Llama 3.1 Nemotron 70B Instruct',
    id: 'nvidia/llama-3.1-nemotron-70b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'An advanced small language model designed for edge applications.',
    displayName: 'Gemma 2 2B Instruct',
    id: 'google/gemma-2-2b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A frontier text generation model strong in understanding, transformation, and code generation.',
    displayName: 'Gemma 2 9B Instruct',
    id: 'google/gemma-2-9b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A frontier text generation model strong in understanding, transformation, and code generation.',
    displayName: 'Gemma 2 27B Instruct',
    id: 'google/gemma-2-27b-it',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'A bilingual LLM for Chinese and English across language, coding, math, and reasoning.',
    displayName: 'Qwen2.5 7B Instruct',
    id: 'qwen/qwen2.5-7b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'A strong mid-sized code model with 32K context, excelling at multilingual programming.',
    displayName: 'Qwen2.5 Coder 7B Instruct',
    id: 'qwen/qwen2.5-coder-7b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'An advanced LLM for code generation, reasoning, and repair across mainstream programming languages.',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    id: 'qwen/qwen2.5-coder-32b-instruct',
    type: 'chat',
  },
];

export const allModels = [...nvidiaChatModels];

export default allModels;
