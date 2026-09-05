import type { AIChatModelCard } from '../types/aiModel';

// https://cloud.sambanova.ai/plans/pricing
// https://docs.sambanova.ai/docs/en/models/sambacloud-models

const sambanovaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 192_000,
    description:
      'MiniMax-M2.7 is a self-evolving foundation model with top-tier reasoning, coding, and agentic capabilities, delivering high throughput for production workloads.',
    displayName: 'MiniMax M2.7',
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3.1 is an upgraded version of DeepSeek-V3 with improved reasoning capabilities, better instruction following, and stronger multilingual support.',
    displayName: 'DeepSeek V3.1',
    family: 'deepseek',
    generation: 'deepseek-v3.1',
    id: 'DeepSeek-V3.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Meta Llama 3.3 70B Instruct',
    family: 'llama',
    generation: 'llama-3.3',
    id: 'Meta-Llama-3.3-70B-Instruct',
    knowledgeCutoff: '2023-12',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'OpenAI GPT-OSS 120B is a top-tier open-source language model with 120 billion parameters, offering strong reasoning and coding capabilities.',
    displayName: 'GPT OSS 120B',
    enabled: true,
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss-120b',
    knowledgeCutoff: '2024-06',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'MiniMax-M3 is a frontier multimodal model with native image and video understanding, long-context reasoning, and strong coding and agentic capabilities.',
    displayName: 'MiniMax M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'MiniMax-M3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'DeepSeek-V3.2 is a preview model with enhanced reasoning and code generation capabilities. Intended for evaluation and experimentation only.',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    generation: 'deepseek-v3.2',
    id: 'DeepSeek-V3.2',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
      "Gemma 4 31B IT is Google's latest multimodal model supporting text, image, and video understanding. Preview model for evaluation purposes only.",
    displayName: 'Gemma 4 31B IT',
    family: 'gemma',
    generation: 'gemma-4',
    id: 'gemma-4-31B-it',
    knowledgeCutoff: '2025-01',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...sambanovaChatModels];

export default allModels;
