import type { ModelParamsSchema } from '../standard-parameters';
import type { AIImageModelCard } from '../types/aiModel';

export const fluxSchnellParamsSchema: ModelParamsSchema = {
  height: { default: 1024, max: 1536, min: 512, step: 1 },
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 4, max: 12, min: 1, step: 1 },
  width: { default: 1024, max: 1536, min: 512, step: 1 },
};

export const fluxKreaParamsSchema: ModelParamsSchema = {
  cfg: { default: 7.5, max: 20, min: 0, step: 0.1 },
  height: { default: 1248, max: 2048, min: 512, step: 1 },
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 28, max: 50, min: 1, step: 1 },
  width: { default: 832, max: 2048, min: 512, step: 1 },
};

export const qwenImageParamsSchema: ModelParamsSchema = {
  cfg: { default: 2.5, max: 20, min: 0, step: 0.1 },
  // Tested: fal width/height max support up to 1536
  // Default values from https://chat.qwen.ai/ official website
  height: { default: 1328, max: 1536, min: 512, step: 1 },
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 30, max: 50, min: 2, step: 1 },
  width: { default: 1328, max: 1536, min: 512, step: 1 },
};

export const qwenEditParamsSchema: ModelParamsSchema = {
  cfg: { default: 4, max: 20, min: 0, step: 0.1 },
  height: { default: 1328, max: 1536, min: 512, step: 1 },
  imageUrl: { default: null },
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 30, max: 50, min: 2, step: 1 },
  width: { default: 1328, max: 1536, min: 512, step: 1 },
};

export const huanyuanImageParamsSchema: ModelParamsSchema = {
  cfg: { default: 7.5, max: 20, min: 1, step: 0.1 },
  prompt: { default: '' },
  seed: { default: null },
  size: {
    default: 'square_hd',
    enum: [
      'square_hd',
      'square',
      'portrait_4_3',
      'portrait_16_9',
      'landscape_4_3',
      'landscape_16_9',
    ],
  },
  steps: { default: 28, max: 50, min: 1, step: 1 },
};

const falImageModels: AIImageModelCard[] = [
  {
    description:
      'Nano Banana is Google’s newest, fastest, and most efficient native multimodal model, enabling image generation and editing through conversation.',
    displayName: 'Nano Banana',
    enabled: true,
    id: 'fal-ai/nano-banana',
    parameters: {
      imageUrls: { default: [], maxCount: 10 },
      prompt: {
        default: '',
      },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.039, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-26',
    type: 'image',
  },
  {
    description:
      'Seedream 4.0 is an image generation model from ByteDance Seed, supporting text and image inputs with highly controllable, high-quality image generation. It generates images from text prompts.',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'fal-ai/bytedance/seedream/v4',
    parameters: {
      height: { default: 1024, max: 4096, min: 1024, step: 1 },
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 1024, step: 1 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-09',
    type: 'image',
  },
  {
    description: 'A powerful native multimodal image generation model.',
    displayName: 'HunyuanImage 3.0',
    enabled: true,
    id: 'fal-ai/hunyuan-image/v3',
    parameters: huanyuanImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.1, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2025-09-28',
    type: 'image',
  },
  {
    description: 'FLUX.1 model focused on image editing, supporting text and image inputs.',
    displayName: 'FLUX.1 Kontext [dev]',
    enabled: true,
    id: 'fal-ai/flux-kontext/dev',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
      steps: { default: 28, max: 50, min: 10 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2025-06-28',
    type: 'image',
  },
  {
    description:
      'FLUX.1 Kontext [pro] accepts text and reference images as input, enabling targeted local edits and complex global scene transformations.',
    displayName: 'FLUX.1 Kontext [pro]',
    enabled: true,
    id: 'fal-ai/flux-pro/kontext',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['21:9', '16:9', '4:3', '3:2', '1:1', '2:3', '3:4', '9:16', '9:21'],
      },
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-05-01',
    type: 'image',
  },
  {
    description:
      'FLUX.1 [schnell] is a 12B-parameter image generation model built for fast, high-quality output.',
    displayName: 'FLUX.1 Schnell',
    enabled: true,
    id: 'fal-ai/flux/schnell',
    parameters: fluxSchnellParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.003, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
  {
    description:
      'Flux Krea [dev] is an image generation model with an aesthetic bias toward more realistic, natural images.',
    displayName: 'FLUX.1 Krea [dev]',
    enabled: true,
    id: 'fal-ai/flux/krea',
    parameters: fluxKreaParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2025-07-31',
    type: 'image',
  },
  {
    description: 'High-quality image generation model from Google.',
    displayName: 'Imagen 4',
    enabled: true,
    id: 'fal-ai/imagen4/preview',
    organization: 'Deepmind',
    parameters: {
      aspectRatio: {
        default: '1:1',
        enum: ['1:1', '16:9', '9:16', '3:4', '4:3'],
      },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-05-21',
    type: 'image',
  },
  {
    description:
      'A professional image editing model from the Qwen team that supports semantic and appearance edits, precisely edits Chinese and English text, and enables high-quality edits such as style transfer and object rotation.',
    displayName: 'Qwen Edit',
    enabled: true,
    id: 'fal-ai/qwen-image-edit',
    parameters: qwenEditParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2025-08-19',
    type: 'image',
  },
  {
    description:
      'A powerful image generation model from the Qwen team with impressive Chinese text rendering and diverse visual styles.',
    displayName: 'Qwen Image',
    enabled: true,
    id: 'fal-ai/qwen-image',
    parameters: qwenImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'megapixel' }],
    },
    releasedAt: '2025-08-04',
    type: 'image',
  },
];

export const allModels = [...falImageModels];

export default allModels;
