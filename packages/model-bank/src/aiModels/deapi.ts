import type { AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

// The OpenAI-compatible gateway validates `size` and `seconds` against each model's own list
// and maps `quality` to a per-model step preset (e.g. 2 / 4 / 8 steps for FLUX.1 schnell).
// https://docs.deapi.ai/openai-compatibility
const qualityParam = { default: 'medium', enum: ['low', 'medium', 'high'] };

// Reference images are capped at 10 MB each by the platform.
const MAX_REFERENCE_FILE_SIZE = 10 * 1024 * 1024;

const deapiImageModels: AIImageModelCard[] = [
  {
    description:
      'Z-Image Turbo is a distilled 6B text-to-image model from Alibaba Tongyi with strong photorealism and bilingual text rendering.',
    displayName: 'Z-Image Turbo',
    enabled: true,
    id: 'ZImageTurbo_INT8',
    organization: 'Alibaba',
    parameters: {
      prompt: { default: '' },
      quality: qualityParam,
      size: { default: '1024x1024', enum: ['512x512', '768x768', '1024x1024'] },
    },
    type: 'image',
  },
  {
    description:
      'FLUX.2 [klein] 4B from Black Forest Labs generates images from text and edits or combines up to three reference images.',
    displayName: 'FLUX.2 [klein] 4B',
    enabled: true,
    id: 'Flux_2_Klein_4B_BF16',
    organization: 'Black Forest Labs',
    parameters: {
      imageUrls: { default: [], maxCount: 3, maxFileSize: MAX_REFERENCE_FILE_SIZE },
      prompt: { default: '' },
      quality: qualityParam,
      size: {
        default: '1024x1024',
        enum: ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'FLUX.1 [schnell] is a fast, distilled 12B text-to-image model from Black Forest Labs.',
    displayName: 'FLUX.1 [schnell]',
    enabled: true,
    id: 'Flux1schnell',
    organization: 'Black Forest Labs',
    parameters: {
      prompt: { default: '' },
      quality: qualityParam,
      size: {
        default: '1024x1024',
        enum: ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'],
      },
    },
    type: 'image',
  },
  {
    description: 'Z-Anime is an anime-style variant of Z-Image distilled to 8 steps.',
    displayName: 'Z-Anime',
    enabled: true,
    id: 'ZAnimeDistill_8Step_INT8',
    parameters: {
      prompt: { default: '' },
      quality: qualityParam,
      size: { default: '1024x1024', enum: ['512x512', '768x768', '1024x1024'] },
    },
    type: 'image',
  },
];

const deapiVideoModels: AIVideoModelCard[] = [
  {
    description:
      'LTX-2.5 is a 22B distilled video model from Lightricks for text-to-video and image-to-video in landscape and portrait.',
    displayName: 'LTX-2.5',
    enabled: true,
    id: 'Ltx2_5_22B_Dist_INT8',
    organization: 'Lightricks',
    parameters: {
      duration: { default: 5, enum: [3, 4, 5, 6, 8, 10] },
      imageUrl: { default: null, maxFileSize: MAX_REFERENCE_FILE_SIZE },
      prompt: { default: '' },
      size: {
        default: '1344x768',
        enum: ['1344x768', '768x1344', '1024x768', '768x1024', '768x768'],
      },
    },
    type: 'video',
  },
  {
    description:
      'LTX-2.3 is a 22B distilled video model from Lightricks for text-to-video and image-to-video.',
    displayName: 'LTX-2.3',
    enabled: true,
    id: 'Ltx2_3_22B_Dist_INT8',
    organization: 'Lightricks',
    parameters: {
      duration: { default: 5, enum: [3, 4, 5, 6, 8, 10] },
      imageUrl: { default: null, maxFileSize: MAX_REFERENCE_FILE_SIZE },
      prompt: { default: '' },
      size: { default: '1024x768', enum: ['1024x768', '768x1024', '1024x1024', '768x768'] },
    },
    type: 'video',
  },
  {
    description:
      'MiniMax H3 Turbo generates 8-second clips from text or a first frame with strong motion and prompt adherence.',
    displayName: 'MiniMax H3 Turbo',
    enabled: true,
    id: 'MiniMaxH3_33B_Turbo_INT8',
    organization: 'MiniMax',
    parameters: {
      duration: { default: 8, enum: [8] },
      imageUrl: { default: null, maxFileSize: MAX_REFERENCE_FILE_SIZE },
      prompt: { default: '' },
      size: {
        default: '1344x768',
        enum: ['1344x768', '768x1344', '1024x768', '768x1024', '768x768'],
      },
    },
    type: 'video',
  },
  {
    description:
      'LTX-Video 13B 0.9.8 Distilled from Lightricks renders short 30 fps clips quickly and is the lowest-cost video model on deAPI.',
    displayName: 'LTX-Video 13B Distilled',
    enabled: true,
    id: 'Ltxv_13B_0_9_8_Distilled_FP8',
    organization: 'Lightricks',
    parameters: {
      duration: { default: 4, enum: [1, 2, 3, 4] },
      imageUrl: { default: null, maxFileSize: MAX_REFERENCE_FILE_SIZE },
      prompt: { default: '' },
      size: { default: '768x512', enum: ['768x512', '512x768', '768x768', '512x512'] },
    },
    type: 'video',
  },
];

export const allModels = [...deapiImageModels, ...deapiVideoModels];

export default allModels;
