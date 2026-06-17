import type { ModelParamsSchema } from '../standard-parameters';
import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://empiriolabs.ai/models
const empiriolabsChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max is a flagship text model for coding, productivity, long-running agents, deep thinking, and tool use.',
    displayName: 'Qwen3.7 Max',
    id: 'qwen3-7-max',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Cost-effective Qwen3.7 vision-language model for text, image, video, coding, tool use, GUI understanding, and 1M-context workflows.',
    displayName: 'Qwen3.7 Plus',
    id: 'qwen3-7-plus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 flagship MoE LLM with 1.6T total / 49B active parameters and native 1M context.',
    displayName: 'DeepSeek V4 Pro',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Lightweight DeepSeek V4 MoE model with 284B total / 13B active parameters and native 1M context.',
    displayName: 'DeepSeek V4 Flash',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_000,
    description:
      'Long-context Zhipu AI reasoning model with 202K context, 128K output, and tool use.',
    displayName: 'GLM-5.1',
    id: 'glm-5-1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.825, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.301, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6 is a Moonshot multimodal reasoning model with 256K context and strong agentic skills.',
    displayName: 'Kimi K2.6',
    id: 'kimi-k2-6',
    maxOutput: 16_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8939, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.7131, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 524_288,
    description:
      'MiniMax M3 is a multimodal reasoning model for coding, agents, and long-context analysis with text, image, and video input.',
    displayName: 'MiniMax M3',
    id: 'minimax-m3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.225, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Gemma 4 26B A4B is a Google open multimodal model with 256K context and text, image, and video input.',
    displayName: 'Gemma 4 26B A4B',
    id: 'gemma-4-26b-a4b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

// Image-generation parameter schemas. EmpirioLabs serves these through the
// OpenAI-compatible /v1/images/generations endpoint, so the default image
// handler covers them with no custom runtime code. imageUrl maps to the
// upstream image-edit input, enabling image-to-image where the model supports it.
export const seedream5LiteParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  seed: { default: null },
  watermark: { default: false },
};

export const qwenImage2ParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: true },
  seed: { default: null },
  size: {
    default: '1664x928',
    enum: ['1664x928', '928x1664', '1328x1328', '1472x1140', '1140x1472', '1024x1024'],
  },
  watermark: { default: false },
};

export const flux2Klein4bParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  seed: { default: null },
  size: {
    default: '1024x1024',
    enum: ['1024x1024', '1344x768', '768x1344', '1184x880', '880x1184', '768x768'],
  },
};

export const novaCanvasParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: 'standard', enum: ['standard', 'premium'] },
  seed: { default: null },
  size: {
    default: '1024x1024',
    enum: ['1024x1024', '1024x576', '576x1024', '1024x768', '768x1024', '512x512'],
  },
};

export const hunyuanImage3ParamsSchema: ModelParamsSchema = {
  prompt: { default: '' },
  seed: { default: null },
  size: {
    default: '1024x1024',
    enum: ['1024x1024', '768x1024', '1024x768', '1024x1536', '1536x1024', '512x512'],
  },
};

export const wan27ImageParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  resolution: { default: '2K', enum: ['1K', '2K', '4K'] },
  seed: { default: null },
  size: {
    default: '1664x928',
    enum: ['1664x928', '928x1664', '1328x1328', '1472x1140', '1140x1472', '1024x1024'],
  },
  watermark: { default: false },
};

export const janusProParamsSchema: ModelParamsSchema = {
  prompt: { default: '' },
  seed: { default: null },
};

const empiriolabsImageModels: AIImageModelCard[] = [
  {
    description:
      'Seedream 5.0 Lite is a unified multimodal image model that reasons through prompts before rendering, producing high-resolution, consistent edits and brand visuals.',
    displayName: 'Seedream 5.0 Lite',
    enabled: true,
    id: 'seedream-5-0-lite',
    organization: 'ByteDance',
    parameters: seedream5LiteParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Qwen Image 2.0 is a unified image generation and editing model with class-leading complex Chinese and English text rendering, realistic textures, and multi-image fusion.',
    displayName: 'Qwen Image 2.0',
    enabled: true,
    id: 'qwen-image-2-0',
    organization: 'Alibaba',
    parameters: qwenImage2ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.0322, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'FLUX.2 Klein 4B is an Apache-licensed 4B image generation and editing model with text-to-image, reference-image editing, and creative workflow support.',
    displayName: 'FLUX.2 Klein 4B',
    enabled: true,
    id: 'flux-2-klein-4b',
    organization: 'Black Forest Labs',
    parameters: flux2Klein4bParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.0085, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Amazon Nova Canvas creates and modifies images from text or image inputs, with inpainting, virtual try-on, and style controls.',
    displayName: 'Amazon Nova Canvas',
    enabled: true,
    id: 'amazon-nova-canvas',
    organization: 'Amazon',
    parameters: novaCanvasParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.12, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Hunyuan Image 3 is an open-source text-to-image model on a multimodal Mixture-of-Experts architecture with photorealistic detail and strong multilingual text rendering.',
    displayName: 'Hunyuan Image 3',
    enabled: true,
    id: 'hunyuan-image-3',
    organization: 'Tencent',
    parameters: hunyuanImage3ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.13, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Wan2.7 Image is an image generation and editing model with text-to-image, bounding-box edits, and cohesive image sets, with up to 4K output on Pro.',
    displayName: 'Wan2.7 Image',
    enabled: true,
    id: 'wan2-7-image',
    organization: 'Alibaba',
    parameters: wan27ImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Janus-Pro DeepSeek is an autoregressive framework on the Janus Pro 7B model that unifies multimodal understanding and image generation in one architecture.',
    displayName: 'Janus-Pro DeepSeek',
    enabled: true,
    id: 'janus-pro-deepseek',
    organization: 'DeepSeek',
    parameters: janusProParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
];

export const empiriolabsChatModelList = empiriolabsChatModels;
export const empiriolabsImageModelList = empiriolabsImageModels;

export const allModels = [...empiriolabsChatModels, ...empiriolabsImageModels];

export default allModels;
