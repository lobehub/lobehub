import {
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type VideoModelParamsSchema,
} from '../../standard-parameters/video';
import { type AIVideoModelCard } from '../../types/aiModel';

export const seedance15ProParams: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  cameraFixed: { default: false },
  duration: { default: 5, max: 12, min: 4 },
  endImageUrl: { default: null, maxFileSize: 30 * 1024 * 1024, requiresImageUrl: true },
  generateAudio: { default: true },
  imageUrl: { default: null, maxFileSize: 30 * 1024 * 1024 },
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
