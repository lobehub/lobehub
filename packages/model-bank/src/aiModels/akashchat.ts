import type { AIChatModelCard } from '../types/aiModel';

const akashChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek V3.1 is a next-gen reasoning model with improved complex reasoning and chain-of-thought, suited for deep analysis tasks.',
    displayName: 'DeepSeek V3.1',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v3',
    id: 'DeepSeek-V3-1',
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
      'GPT-OSS-120B uses MXFP4-quantized Transformer architecture, maintaining strong performance under resource constraints.',
    displayName: 'GPT-OSS-120B',
    enabled: true,
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss-120b',
    knowledgeCutoff: '2024-06',
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 262_144,
    description:
      'Qwen3 235B A22B Instruct 2507 is optimized for advanced reasoning and instruction-following, using MoE to keep reasoning efficient at scale.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'Qwen3-235B-A22B-Instruct-2507-FP8',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
    id: 'DeepSeek-R1-Distill-Qwen-32B',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 4 Maverick is a large MoE model with efficient expert activation for strong reasoning performance.',
    displayName: 'Llama 4 Maverick (17Bx128E)',
    family: 'llama',
    generation: 'llama-4',
    id: 'Meta-Llama-4-Maverick-17B-128E-Instruct-FP8',
    knowledgeCutoff: '2024-08',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Llama 3.3 70B is a versatile Transformer model for chat and generation tasks.',
    displayName: 'Llama 3.3 70B',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'Meta-Llama-3-3-70B-Instruct',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    displayName: 'Llama 3.1 8B',
    family: 'llama',
    generation: 'llama-3.1',
    id: 'Meta-Llama-3-1-8B-Instruct-FP8',
    knowledgeCutoff: '2023-12',
    type: 'chat',
  },
];
export const allModels = [...akashChatModels];

export default allModels;
