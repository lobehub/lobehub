import {
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type VideoModelParamsSchema,
} from '../../standard-parameters/video';
import { type AIVideoModelCard } from '../../types/aiModel';

const seedance20Params: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  duration: { default: 5, max: 15, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrls: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: [],
    height: { max: 6000, min: 300 },
    maxCount: 9,
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: PRESET_VIDEO_RESOLUTIONS,
  },
  seed: { default: null },
};

const seedance15ProParams: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  cameraFixed: { default: false },
  duration: { default: 5, max: 12, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: PRESET_VIDEO_RESOLUTIONS,
  },
  seed: { default: null },
};

export const volcengineVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Seedance 2.0 by ByteDance is the most powerful video generation model, supporting multimodal reference video generation, video editing, video extension, text-to-video, and image-to-video with synchronized audio.',
    displayName: 'Seedance 2.0',
    enabled: true,
    id: 'doubao-seedance-2-0-260128',
    organization: 'ByteDance',
    parameters: {
      ...seedance20Params,
      watermark: { default: false },
      webSearch: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 37, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Seedance 2.0 Fast by ByteDance offers the same capabilities as Seedance 2.0 with faster generation speeds at a more competitive price.',
    displayName: 'Seedance 2.0 Fast',
    enabled: true,
    id: 'doubao-seedance-2-0-fast-260128',
    organization: 'ByteDance',
    parameters: {
      ...seedance20Params,
      watermark: { default: false },
      webSearch: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 46, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Seedance 1.5 Pro by ByteDance supports text-to-video, image-to-video (first frame, first+last frame), and audio generation synchronized with visuals.',
    displayName: 'Seedance 1.5 Pro',
    enabled: true,
    id: 'doubao-seedance-1-5-pro-251215',
    organization: 'ByteDance',
    parameters: {
      ...seedance15ProParams,
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            pricingParams: ['generateAudio'],
            prices: { false: 8, true: 16 },
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-15',
    type: 'video',
  },
  {
    description:
      'Seedance 1.0 Pro Fast is a comprehensive model designed to minimize cost while maximizing performance, achieving an excellent balance between video generation quality, speed, and price. It inherits the core strengths of Seedance 1.0 Pro, while offering faster generation speeds and more competitive pricing, delivering creators a dual optimization of efficiency and cost.',
    displayName: 'Seedance 1.0 Pro Fast',
    id: 'doubao-seedance-1-0-pro-fast-251015',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1.1', '3:4', '9:16'],
      },
      cameraFixed: { default: false },
      duration: { default: 5, max: 12, min: 2 },
      imageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        width: { max: 6000, min: 300 },
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['480p', '720p', '1080p'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2025-10-15',
    type: 'video',
  },
  {
    description:
      'Seedance 1.0 Pro is a video generation foundation model that supports multi-shot storytelling. It delivers strong performance across multiple dimensions. The model achieves breakthroughs in semantic understanding and instruction following, enabling it to generate 1080P high-definition videos with smooth motion, rich details, diverse styles, and cinematic-level visual aesthetics.',
    displayName: 'Seedance 1.0 Pro',
    id: 'doubao-seedance-1-0-pro-250528',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1.1', '3:4', '9:16'],
      },
      cameraFixed: { default: false },
      duration: { default: 5, max: 12, min: 2 },
      endImageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        requiresImageUrl: true,
        width: { max: 6000, min: 300 },
      },
      imageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        width: { max: 6000, min: 300 },
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['480p', '720p', '1080p'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2025-05-28',
    type: 'video',
  },
];
