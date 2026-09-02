import type { ModelParamsSchema, VideoModelParamsSchema } from '../standard-parameters';
import type { AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

/**
 * WaveSpeed exposes each model family as its own endpoint, so the model id is
 * the API path (e.g. `bytedance/seedream-v5.0-pro/edit`). Editing endpoints are
 * separate ids from their text-to-image counterparts.
 */

const SEEDREAM_ASPECT_RATIOS = [
  '1:1',
  '1:2',
  '2:1',
  '1:3',
  '3:1',
  '2:3',
  '3:2',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '9:21',
  '21:9',
];

const NANO_BANANA_ASPECT_RATIOS = [
  '1:1',
  '3:2',
  '2:3',
  '3:4',
  '4:3',
  '4:5',
  '5:4',
  '9:16',
  '16:9',
  '21:9',
  '1:4',
  '4:1',
  '1:8',
  '8:1',
];

export const seedream5ParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: SEEDREAM_ASPECT_RATIOS },
  prompt: { default: '' },
  resolution: { default: '1k', enum: ['1k', '1.5k', '2k'] },
};

export const seedream5EditParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: SEEDREAM_ASPECT_RATIOS },
  imageUrls: { default: [], maxCount: 10 },
  prompt: { default: '' },
  resolution: { default: '1k', enum: ['1k', '1.5k', '2k'] },
};

export const nanoBanana2ParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: NANO_BANANA_ASPECT_RATIOS },
  prompt: { default: '' },
  resolution: { default: '1k', enum: ['0.5k', '1k', '2k', '4k'] },
  webSearch: { default: false },
};

export const nanoBanana2EditParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: NANO_BANANA_ASPECT_RATIOS },
  imageUrls: { default: [], maxCount: 14 },
  prompt: { default: '' },
  resolution: { default: '1k', enum: ['0.5k', '1k', '2k', '4k'] },
  webSearch: { default: false },
};

export const gptImage2ParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: SEEDREAM_ASPECT_RATIOS },
  prompt: { default: '' },
  quality: { default: 'medium', enum: ['low', 'medium', 'high'] },
  resolution: { default: '1k', enum: ['1k', '2k', '4k'] },
};

export const gptImage2EditParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: SEEDREAM_ASPECT_RATIOS },
  imageUrls: { default: [], maxCount: 16 },
  prompt: { default: '' },
  quality: { default: 'medium', enum: ['low', 'medium', 'high'] },
  resolution: { default: '1k', enum: ['1k', '2k', '4k'] },
};

/**
 * WAN takes explicit pixel dimensions rather than an aspect ratio; the runtime
 * folds `width`/`height` into WaveSpeed's `{width}*{height}` size field.
 */
export const wan26ImageParamsSchema: ModelParamsSchema = {
  height: { default: 1024, max: 1440, min: 768, step: 8 },
  prompt: { default: '' },
  promptExtend: { default: false },
  seed: { default: null },
  width: { default: 1024, max: 1440, min: 768, step: 8 },
};

const wavespeedImageModels: AIImageModelCard[] = [
  {
    description:
      'Seedream 5.0 Pro is ByteDance’s flagship image model, combining strong prompt adherence with cinematic composition and reliable Chinese and English text rendering at up to 2K.',
    displayName: 'Seedream 5.0 Pro',
    enabled: true,
    id: 'bytedance/seedream-v5.0-pro',
    parameters: seedream5ParamsSchema,
    releasedAt: '2026-07-08',
    type: 'image',
  },
  {
    description:
      'Seedream 5.0 Pro image editing takes up to 10 reference images and applies instruction-driven edits while preserving subject and style consistency.',
    displayName: 'Seedream 5.0 Pro (Edit)',
    enabled: true,
    id: 'bytedance/seedream-v5.0-pro/edit',
    parameters: seedream5EditParamsSchema,
    releasedAt: '2026-07-08',
    type: 'image',
  },
  {
    description:
      'Nano Banana 2 (Gemini 3.1 Flash Image) delivers Pro-quality generation at Flash speed, with resolutions from 0.5K to 4K, improved text rendering and real-world knowledge grounding.',
    displayName: 'Nano Banana 2',
    enabled: true,
    id: 'google/nano-banana-2/text-to-image',
    parameters: nanoBanana2ParamsSchema,
    releasedAt: '2026-02-26',
    type: 'image',
  },
  {
    description:
      'Nano Banana 2 image editing accepts up to 14 reference images and keeps character consistency across multi-subject edits.',
    displayName: 'Nano Banana 2 (Edit)',
    enabled: true,
    id: 'google/nano-banana-2/edit',
    parameters: nanoBanana2EditParamsSchema,
    releasedAt: '2026-02-26',
    type: 'image',
  },
  {
    description:
      'GPT Image 2 generates high-quality images from natural-language prompts, with selectable quality tiers and up to 4K output.',
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'openai/gpt-image-2/text-to-image',
    parameters: gptImage2ParamsSchema,
    releasedAt: '2026-04-21',
    type: 'image',
  },
  {
    description:
      'GPT Image 2 image editing accepts up to 16 reference images and follows detailed natural-language editing instructions.',
    displayName: 'GPT Image 2 (Edit)',
    enabled: true,
    id: 'openai/gpt-image-2/edit',
    parameters: gptImage2EditParamsSchema,
    releasedAt: '2026-04-21',
    type: 'image',
  },
  {
    description:
      'WAN 2.6 text-to-image renders detailed, photoreal scenes from plain prompts with optional prompt expansion.',
    displayName: 'WAN 2.6 (Text to Image)',
    enabled: true,
    id: 'alibaba/wan-2.6/text-to-image',
    parameters: wan26ImageParamsSchema,
    releasedAt: '2025-12-16',
    type: 'image',
  },
];

export const seedance25TextToVideoParamsSchema: VideoModelParamsSchema = {
  aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '4:3', '3:4', '1:1', '21:9'] },
  duration: { default: 5, max: 30, min: 4, step: 1 },
  generateAudio: { default: true },
  prompt: { default: '' },
  resolution: { default: '720p', enum: ['480p', '720p', '1080p', '4k'] },
};

export const seedance25ImageToVideoParamsSchema: VideoModelParamsSchema = {
  duration: { default: 5, max: 30, min: 4, step: 1 },
  endImageUrl: { default: null },
  generateAudio: { default: true },
  imageUrl: { default: null },
  prompt: { default: '' },
  resolution: { default: '720p', enum: ['480p', '720p', '1080p', '4k'] },
};

export const wan26TextToVideoParamsSchema: VideoModelParamsSchema = {
  duration: { default: 5, enum: [5, 10, 15] },
  prompt: { default: '' },
  promptExtend: { default: false },
  seed: { default: null },
  size: { default: '1280x720', enum: ['1280x720', '720x1280', '1920x1080', '1080x1920'] },
};

export const wan26ImageToVideoParamsSchema: VideoModelParamsSchema = {
  duration: { default: 5, enum: [5, 10, 15] },
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: false },
  resolution: { default: '720p', enum: ['720p', '1080p'] },
  seed: { default: null },
};

const wavespeedVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Seedance 2.5 generates cinematic video from text with native audio, director-level camera control and strong motion stability, up to 4K and 30 seconds.',
    displayName: 'Seedance 2.5 (Text to Video)',
    enabled: true,
    id: 'bytedance/seedance-2.5/text-to-video',
    parameters: seedance25TextToVideoParamsSchema,
    releasedAt: '2026-08-07',
    type: 'video',
  },
  {
    description:
      'Seedance 2.5 animates a still image into a cinematic clip with native audio, and can interpolate toward an optional final frame.',
    displayName: 'Seedance 2.5 (Image to Video)',
    enabled: true,
    id: 'bytedance/seedance-2.5/image-to-video',
    parameters: seedance25ImageToVideoParamsSchema,
    releasedAt: '2026-08-07',
    type: 'video',
  },
  {
    description:
      'WAN 2.6 turns plain prompts into coherent, cinematic clips with crisp detail, stable motion and strong instruction following.',
    displayName: 'WAN 2.6 (Text to Video)',
    enabled: true,
    id: 'alibaba/wan-2.6/text-to-video',
    parameters: wan26TextToVideoParamsSchema,
    releasedAt: '2025-12-06',
    type: 'video',
  },
  {
    description:
      'WAN 2.6 image-to-video animates a reference image into a stable, cinematic clip at up to 1080p.',
    displayName: 'WAN 2.6 (Image to Video)',
    enabled: true,
    id: 'alibaba/wan-2.6/image-to-video',
    parameters: wan26ImageToVideoParamsSchema,
    releasedAt: '2025-12-06',
    type: 'video',
  },
];

export const allModels = [...wavespeedImageModels, ...wavespeedVideoModels];

export default allModels;
