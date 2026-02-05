import type { AIImageModelCard } from '../../types/aiModel';
import { huanyuanImageParamsSchema, qwenEditParamsSchema, qwenImageParamsSchema } from '../fal';
import {
  gptImage1Schema,
  imagenBaseParameters,
  nanoBananaParameters,
  nanoBananaProParameters,
} from './utils';

export const lobehubImageModels: AIImageModelCard[] = [
  {
    description:
      "Gemini 3 Pro Image (Nano Banana Pro) is Google's image generation model and also supports multimodal chat.",
    displayName: 'Nano Banana Pro',
    enabled: true,
    id: 'gemini-3-pro-image-preview:image',
    parameters: nanoBananaProParameters,
    pricing: {
      approximatePricePerImage: 0.134,
      units: [
        { name: 'imageOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-18',
    type: 'image',
  },
  {
    description:
      "Nano Banana is Google's newest, fastest, and most efficient native multimodal model, enabling conversational image generation and editing.",
    displayName: 'Nano Banana',
    id: 'gemini-2.5-flash-image-preview:image',
    parameters: nanoBananaParameters,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'image',
  },
  {
    description: 'Imagen 4th generation text-to-image model series',
    displayName: 'Imagen 4 Fast',
    id: 'imagen-4.0-fast-generate-001',
    organization: 'Deepmind',
    parameters: imagenBaseParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.02, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-15',
    type: 'image',
  },
  {
    description: 'Imagen 4th generation text-to-image model series',
    displayName: 'Imagen 4',
    id: 'imagen-4.0-generate-001',
    organization: 'Deepmind',
    parameters: imagenBaseParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-15',
    type: 'image',
  },
  {
    description: 'Imagen 4th generation text-to-image model series Ultra version',
    displayName: 'Imagen 4 Ultra',
    id: 'imagen-4.0-ultra-generate-001',
    organization: 'Deepmind',
    parameters: imagenBaseParameters,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-15',
    type: 'image',
  },
  {
    description:
      'An enhanced GPT Image 1 model with 4× faster generation, more precise editing, and improved text rendering.',
    displayName: 'GPT Image 1.5',
    enabled: true,
    id: 'gpt-image-1.5',
    parameters: gptImage1Schema,
    pricing: {
      approximatePricePerImage: 0.034,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-16',
    type: 'image',
  },
  {
    description: 'ChatGPT native multimodal image generation model.',
    displayName: 'GPT Image 1',
    id: 'gpt-image-1',
    parameters: gptImage1Schema,
    pricing: {
      approximatePricePerImage: 0.042,
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'image',
  },
  {
    description:
      'The latest DALL·E model, released in November 2023, supports more realistic, accurate image generation with stronger detail.',
    displayName: 'DALL·E 3',
    id: 'dall-e-3',
    parameters: {
      prompt: { default: '' },
      quality: {
        default: 'standard',
        enum: ['standard', 'hd'],
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1792x1024', '1024x1792'],
      },
    },
    pricing: {
      approximatePricePerImage: 0.004,
      units: [
        {
          lookup: {
            prices: {
              hd_1024x1024: 0.08,
              hd_1024x1792: 0.12,
              hd_1792x1024: 0.12,
              standard_1024x1024: 0.04,
              standard_1024x1792: 0.08,
              standard_1792x1024: 0.08,
            },
            pricingParams: ['quality', 'size'],
          },
          name: 'imageGeneration',
          strategy: 'lookup',
          unit: 'image',
        },
      ],
    },
    type: 'image',
  },
  {
    description:
      'Seedream 4.5, built by ByteDance Seed team, supports multi-image editing and composition. Features enhanced subject consistency, precise instruction following, spatial logic understanding, aesthetic expression, poster layout and logo design with high-precision text-image rendering.',
    displayName: 'Seedream 4.5',
    enabled: true,
    id: 'fal-ai/bytedance/seedream/v4.5',
    parameters: {
      height: { default: 2048, max: 4096, min: 1920, step: 1 },
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: { default: '' },
      seed: { default: null },
      width: { default: 2048, max: 4096, min: 1920, step: 1 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-04',
    type: 'image',
  },
  {
    description:
      'Seedream 4.0, built by ByteDance Seed, supports text and image inputs for highly controllable, high-quality image generation from prompts.',
    displayName: 'Seedream 4.0',
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
      // Original price: 0.1 x 1024 x 1024 / 100_0000 = 0.1048576$
      units: [{ name: 'imageGeneration', rate: 0.11, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-28',
    type: 'image',
  },
  {
    description:
      'A professional image editing model from the Qwen team, supporting semantic and appearance edits, precise Chinese/English text editing, style transfer, rotation, and more.',
    displayName: 'Qwen Edit',
    enabled: true,
    id: 'fal-ai/qwen-image-edit',
    parameters: qwenEditParamsSchema,
    pricing: {
      // https://fal.ai/models/fal-ai/qwen-image-edit
      // Original price: 0.03 x 1328 x 1328 / 100_0000 = 0.05290752
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-19',
    type: 'image',
  },
  {
    description:
      'A powerful image generation model from the Qwen team with strong Chinese text rendering and diverse visual styles.',
    displayName: 'Qwen Image',
    enabled: true,
    id: 'fal-ai/qwen-image',
    parameters: qwenImageParamsSchema,
    pricing: {
      // Original price: 0.02 x 1328 x 1328 / 100_0000 = 0.03527168
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-04',
    type: 'image',
  },
];
