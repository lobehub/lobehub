import { type AIChatModelCard } from '../types/aiModel';

const gitgotModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The 120B open-weight model from OpenAI. Reasoning effort is graded on this host: low, medium and high each change how much it thinks.',
    displayName: 'GPT OSS 120B',
    enabled: true,
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'openai/gpt-oss-120b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03626, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1666, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 262_144,
    description:
      'The code-tuned Kimi K2.7 from Moonshot AI, with a 262k context for whole-repository work. Reasoning always runs and is not caller-controlled.',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'moonshotai/Kimi-K2.7-Code',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6664, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.332, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6 from Moonshot AI, a large MoE model with strong tool use. Reasoning always runs and is not caller-controlled.',
    displayName: 'Kimi K2.6',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'moonshotai/Kimi-K2.6',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.735, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.43, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'The open-weight MoE flagship from DeepSeek. Reasoning is off by default on this host and switched on per request.',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Pro',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.274, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.548, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 163_840,
    description:
      'The fast open-weight MoE from DeepSeek. Reasoning is off by default on this host and switched on per request.',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Flash',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.0882, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1764, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 163_840,
    description: 'The dated 0731 build of DeepSeek V4 Flash, pinned so a run can be reproduced.',
    displayName: 'DeepSeek V4 Flash 0731',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-ai/DeepSeek-V4-Flash-0731',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.0588, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1764, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Llama 3.3 70B from Meta, instruction tuned. Built with Llama.',
    displayName: 'Llama 3.3 70B Instruct',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'meta-llama/Llama-3.3-70B-Instruct',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1323, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.392, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export default gitgotModels;
