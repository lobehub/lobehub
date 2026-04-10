import {
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type VideoModelParamsSchema,
} from '../../standard-parameters/video';
import { type AIVideoModelCard } from '../../types/aiModel';

export const seedance20Params: VideoModelParamsSchema = {
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
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: ['480p', '720p'],
  },
  seed: { default: null },
};

export const seedance15ProParams: VideoModelParamsSchema = {
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

export const lobehubVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Seedance 2.0 by ByteDance is the most powerful video generation model, supporting multimodal reference video generation, video editing, video extension, text-to-video, and image-to-video with synchronized audio.',
    displayName: 'Seedance 2.0',
    enabled: true,
    id: 'doubao-seedance-2-0-260128',
    organization: 'ByteDance',
    parameters: seedance20Params,
    pricing: {
      approximatePricePerVideo: 0.82,
      units: [
        {
          name: 'videoGeneration',
          rate: 7.56,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
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
    parameters: seedance20Params,
    pricing: {
      approximatePricePerVideo: 0.66,
      units: [
        {
          name: 'videoGeneration',
          rate: 6.08,
          strategy: 'fixed',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Seedance 1.5 Pro by ByteDance supports text-to-video, image-to-video (first frame, first+last frame), and audio generation synchronized with visuals.',
    displayName: 'Seedance 1.5 Pro',
    enabled: true,
    id: 'seedance-1-5-pro-251215',
    organization: 'ByteDance',
    parameters: seedance15ProParams,
    pricing: {
      approximatePricePerVideo: 0.25,
      units: [
        {
          lookup: {
            pricingParams: ['generateAudio'],
            prices: { false: 1.2, true: 2.4 },
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
];
