import type { ModelParamsSchema } from '../standard-parameters';
import type { AIChatModelCard, AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

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

// Video models are served through the async /v1/videos/generations endpoint
// (submit returns a job id, the result is polled at /v1/jobs/{id}). The
// EmpirioLabs runtime provider supplies createVideo + handlePollVideoStatus.
// Each card exposes only the parameters that map to a field the worker reads,
// and the runtime forwards them as the camelCase keys the provider translates.
const empiriolabsVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Multimodal video model supporting text-to-video, image-to-video, video editing, and reference-to-video, with high-fidelity output from text, image, or video inputs.',
    displayName: 'Wan 2.7',
    enabled: true,
    id: 'wan-2-7',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 2 },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Multi-shot video model with text-to-video, image-to-video, and reference-to-video, native audio, and a flash speed tier for faster, lower-cost clips.',
    displayName: 'Wan 2.6',
    enabled: true,
    id: 'wan-2-6',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 5 },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.138, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Seedance 2.0 Pro generates cinematic text-to-video and image-to-video up to 1080p with native audio, reference frames, and editing modes.',
    displayName: 'Seedance 2.0 Pro',
    enabled: true,
    id: 'seedance-2-0-pro',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 15, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.3, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Seedance 2.0 Fast generates text-to-video and image-to-video up to 720p with native audio, optimized for quicker, lower-cost generation.',
    displayName: 'Seedance 2.0 Fast',
    enabled: true,
    id: 'seedance-2-0-fast',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 15, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.26, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Kling O3 produces high-quality text-to-video and image-to-video with standard, pro, and 4K tiers, optional sound, and start and end frame control.',
    displayName: 'Kling O3',
    enabled: true,
    id: 'kling-o3',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '1:1', '9:16'] },
      duration: { default: 5, max: 15, min: 3 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      imageUrls: { default: [], maxCount: 4 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.224, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Hunyuan Video 1.5 generates text-to-video and image-to-video up to 1080p with adjustable steps and guidance for detailed, controllable motion.',
    displayName: 'Hunyuan Video 1.5',
    enabled: true,
    id: 'hunyuan-video-1-5',
    organization: 'Tencent',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 10, min: 1 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '480p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.061, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Pixverse v5.6 creates text-to-video and image-to-video up to 1080p with optional audio, start and end frames, and multiple stylistic presets.',
    displayName: 'Pixverse v5.6',
    enabled: true,
    id: 'pixverse-v5-6',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '4:3', '1:1', '3:4', '9:16'] },
      duration: { default: 5, enum: [5, 8, 10], max: 10, min: 5 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '1080p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 1.5, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'Pixverse v5 creates text-to-video and image-to-video up to 1080p with transitions and start and end frame control.',
    displayName: 'Pixverse v5',
    enabled: true,
    id: 'pixverse-v5',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '4:3', '1:1', '3:4', '9:16'] },
      duration: { default: 5, enum: [5, 8], max: 8, min: 5 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.6, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'MOSS Video and Audio generates synchronized video and audio from text or an image, with fast and quality modes and adjustable guidance.',
    displayName: 'MOSS Video and Audio',
    enabled: true,
    id: 'moss-video-and-audio',
    organization: 'OpenMOSS',
    parameters: {
      duration: { default: 8, max: 8, min: 2 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '720p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 2.82, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'HappyHorse 1.0 generates faithful text-to-video, image-to-video, and reference-to-video with smooth, detailed motion and editing support.',
    displayName: 'HappyHorse 1.0',
    enabled: true,
    id: 'happyhorse-1-0',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 3 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'SVI 2.0 Pro generates multi-scene video from text or an image, with fast and quality modes and configurable resolution and duration.',
    displayName: 'SVI 2.0 Pro',
    enabled: true,
    id: 'svi-2-0-pro',
    organization: 'VITA-EPFL',
    parameters: {
      duration: { default: 18, max: 121.5, min: 18 },
      imageUrl: { default: null },
      prompt: { default: '' },
      size: {
        default: '832x480',
        enum: ['832x480', '480x832', '720x1280', '1280x720'],
      },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.17, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Grok Imagine Video 1.5 is an image-to-video model that animates a source image with a prompt, producing 480p or 720p clips.',
    displayName: 'Grok Imagine Video 1.5',
    enabled: true,
    id: 'grok-imagine-video-1-5',
    organization: 'xAI',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
      duration: { default: 10, max: 15, min: 1 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.168, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Amazon Nova Reel 1.1 generates text-to-video clips with multi-shot support for longer, narrative sequences.',
    displayName: 'Amazon Nova Reel 1.1',
    enabled: true,
    id: 'amazon-nova-reel-1-1',
    organization: 'Amazon',
    parameters: {
      duration: { default: 6, max: 120, min: 6 },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.14, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
];

export const empiriolabsChatModelList = empiriolabsChatModels;
export const empiriolabsImageModelList = empiriolabsImageModels;
export const empiriolabsVideoModelList = empiriolabsVideoModels;

export const allModels = [
  ...empiriolabsChatModels,
  ...empiriolabsImageModels,
  ...empiriolabsVideoModels,
];

export default allModels;
