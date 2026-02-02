import { PRESET_ASPECT_RATIOS } from '../standard-parameters';
import { AIChatModelCard, AIImageModelCard, AiFullModelCard } from '../types/aiModel';

const nanoAspectRatios = [...PRESET_ASPECT_RATIOS, '4:5', '5:4', '21:9'];

const imageModels: AIImageModelCard[] = [
  {
    description:
      'High-quality text-to-image generation with flexible aspect ratios and resolution options.',
    displayName: 'Seedream v4.5',
    enabled: true,
    id: 'bytedance/seedream-v4.5',
    parameters: {
      height: { default: 2048, max: 4096, min: 1472, step: 64 },
      prompt: { default: '' },
      width: { default: 2048, max: 4096, min: 1472, step: 64 },
    },
    type: 'image',
  },
  {
    description: 'Fast and flexible text-to-image generation based on FLUX architecture.',
    displayName: 'FLUX 2 Flex',
    enabled: true,
    id: 'black-forest-labs/flux-2-flex/text-to-image',
    parameters: {
      height: { default: 1024, max: 1536, min: 256, step: 64 },
      prompt: { default: '' },
      seed: { default: null },
      width: { default: 1024, max: 1536, min: 256, step: 64 },
    },
    type: 'image',
  },
  {
    description: 'Ultra-quality image generation with aspect ratio and resolution control.',
    displayName: 'Nano Banana Pro Ultra',
    enabled: true,
    id: 'google/nano-banana-pro/text-to-image-ultra',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: nanoAspectRatios,
      },
      prompt: { default: '' },
      resolution: {
        default: '4k',
        enum: ['4k', '8k'],
      },
      seed: { default: null },
    },
    type: 'image',
  },
  {
    description: 'Fast turbo image generation with LoRA support.',
    displayName: 'Z-Image Turbo LoRA',
    enabled: true,
    id: 'z-image/turbo-lora',
    parameters: {
      height: { default: 1024, max: 1536, min: 256, step: 64 },
      prompt: { default: '' },
      seed: { default: null },
      width: { default: 1024, max: 1536, min: 256, step: 64 },
    },
    type: 'image',
  },
];

const chatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is a powerful multimodal model with strong reasoning and vision capabilities.',
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'moonshotai/kimi-k2.5',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.095, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM 4.7 is a large language model with extended context and vision support.',
    displayName: 'GLM 4.7',
    enabled: true,
    id: 'zai-org/glm-4.7',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.52, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek V3.2 is a high-performance model with strong reasoning and function calling.',
    displayName: 'DeepSeek V3.2',
    enabled: true,
    id: 'deepseek-ai/deepseek-v3.2',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 196_608,
    description:
      'MiniMax M2.1 is a versatile model with large context window and vision capabilities.',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'minimaxai/minimax-m2.1',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 252_000,
    description:
      'Qwen3 Max is a top-tier model with massive context window and advanced reasoning.',
    displayName: 'Qwen 3 Max',
    enabled: true,
    id: 'qwen/qwen3-max-2026-01-23',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const atlascloudModels: AiFullModelCard[] = [...chatModels, ...imageModels];

export default atlascloudModels;
