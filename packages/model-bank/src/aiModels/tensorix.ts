import type { AIChatModelCard } from '../types/aiModel';

const tensorixChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1 is a large hybrid reasoning model with 128K context and efficient mode switching, delivering strong performance for tool use, code generation, and complex reasoning.',
    displayName: 'DeepSeek V3.1',
    enabled: true,
    id: 'deepseek/deepseek-chat-v3.1',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1-0528 greatly improves reasoning with minimal labeled data and outputs a chain-of-thought before the final answer to improve accuracy.',
    displayName: 'DeepSeek R1 0528',
    enabled: true,
    id: 'deepseek/deepseek-r1-0528',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'GLM-4.7 is a bilingual open-weights model optimized for code generation, function calling, and agent tasks with strong reasoning and structured output.',
    displayName: 'GLM 4.7',
    enabled: true,
    id: 'z-ai/glm-4.7',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'GLM-5 is the latest generation GLM model with improved reasoning, code generation, and multi-step task capabilities.',
    displayName: 'GLM 5',
    enabled: true,
    id: 'z-ai/glm-5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiniMax M2.1 is a large MoE model with strong general capabilities across coding, reasoning, and multilingual tasks.',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'minimax/minimax-m2.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiniMax M2.5 is the latest MiniMax model with improved instruction following, coding, and long-context performance.',
    displayName: 'MiniMax M2.5',
    enabled: true,
    id: 'minimax/minimax-m2.5',
    type: 'chat',
  },
  {
    contextWindowTokens: 1_048_576,
    description:
      'Llama 4 Maverick is Meta\'s long-context model built for high-throughput generation with strong multilingual and reasoning capabilities.',
    displayName: 'Llama 4 Maverick',
    enabled: true,
    id: 'meta-llama/llama-4-maverick',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost with strong instruction following.',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta-llama/llama-3.3-70b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.2 is the latest iteration of DeepSeek\'s flagship chat series with strong performance across coding, reasoning, and general tasks.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek/deepseek-v3.2',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi K2.5 is a strong model from Moonshot AI with excellent reasoning and instruction following capabilities.',
    displayName: 'Kimi K2.5',
    id: 'moonshotai/kimi-k2.5',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-235B-A22B is a 235B-parameter MoE model with 22B active parameters per forward pass, offering strong reasoning and multilingual support.',
    displayName: 'Qwen3 235B A22B',
    id: 'qwen/qwen3-235b-a22b-2507',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B is a large vision-language model with strong multimodal understanding across text, images, and documents.',
    displayName: 'Qwen3 VL 235B A22B',
    id: 'qwen/qwen3-vl-235b-a22b-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 0324 is a 685B-parameter MoE model with strong performance across general tasks.',
    displayName: 'DeepSeek V3 0324',
    id: 'deepseek/deepseek-chat-v3-0324',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'MiniMax M2 is a large MoE model with strong general capabilities for chat, coding, and reasoning.',
    displayName: 'MiniMax M2',
    id: 'minimax/minimax-m2',
    type: 'chat',
  },
];

export const allModels = [...tensorixChatModels];

export default allModels;
