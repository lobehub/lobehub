import type { ModelParamsSchema } from '../standard-parameters';
import { PRESET_ASPECT_RATIOS } from '../standard-parameters';
import type { AIImageModelCard } from '../types';

// https://docs.bfl.ai/api-reference/tasks/edit-or-create-an-image-with-flux-kontext-pro
// official support 21:9 ~ 9:21 (ratio 0.43 ~ 2.33)
const calculateRatio = (aspectRatio: string): number => {
  const [width, height] = aspectRatio.split(':').map(Number);
  return width / height;
};

const defaultAspectRatios = PRESET_ASPECT_RATIOS.filter((ratio) => {
  const value = calculateRatio(ratio);
  // BFL API supports ratio range: 21:9 ~ 9:21 (approximately 0.43 ~ 2.33)
  // Use a small tolerance for floating point comparison
  return value >= 9 / 21 - 0.001 && value <= 21 / 9 + 0.001;
});

const fluxKontextSeriesParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: defaultAspectRatios,
  },
  imageUrls: {
    default: [],
  },
  prompt: { default: '' },
  seed: { default: null },
};

const imageModels: AIImageModelCard[] = [
  // https://docs.bfl.ai/api-reference/tasks/edit-or-create-an-image-with-flux-kontext-pro
  {
    description:
      'State-of-the-art contextual image generation and editing, combining text and images for precise, coherent results.',
    displayName: 'FLUX.1 Kontext [pro]',
    enabled: true,
    id: 'flux-kontext-pro',
    parameters: fluxKontextSeriesParamsSchema,
    // check: https://bfl.ai/pricing
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-05-29',
    type: 'image',
  },
  // https://docs.bfl.ai/api-reference/tasks/edit-or-create-an-image-with-flux-kontext-max
  {
    description:
      'State-of-the-art contextual image generation and editing, combining text and images for precise, coherent results.',
    displayName: 'FLUX.1 Kontext [max]',
    enabled: true,
    id: 'flux-kontext-max',
    parameters: fluxKontextSeriesParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.08, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-05-29',
    type: 'image',
  },
  // https://docs.bfl.ai/api-reference/tasks/generate-an-image-with-flux-11-[pro]
  {
    description:
      'Upgraded professional-grade image generation model with excellent image quality and precise prompt adherence.',
    displayName: 'FLUX1.1 [pro] ',
    enabled: true,
    id: 'flux-pro-1.1',
    parameters: {
      height: { default: 768, max: 1440, min: 256, step: 32 },
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 256, step: 32 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-10-02',
    type: 'image',
  },
  // https://docs.bfl.ai/api-reference/tasks/generate-an-image-with-flux-11-[pro]-with-ultra-mode-and-optional-raw-mode
  {
    description:
      'Ultra-high-resolution image generation with 4MP output, producing crisp images in 10 seconds.',
    displayName: 'FLUX1.1 [pro] Ultra',
    enabled: true,
    id: 'flux-pro-1.1-ultra',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: defaultAspectRatios,
      },
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-11-06',
    type: 'image',
  },
  // https://docs.bfl.ai/api-reference/tasks/generate-an-image-with-flux1-[pro]
  {
    description:
      'Top-tier commercial image generation model with unmatched image quality and diverse outputs.',
    displayName: 'FLUX.1 [pro]',
    enabled: true,
    id: 'flux-pro',
    parameters: {
      cfg: { default: 2.5, max: 5, min: 1.5, step: 0.1 },
      height: { default: 768, max: 1440, min: 256, step: 32 },
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
      steps: { default: 40, max: 50, min: 1 },
      width: { default: 1024, max: 1440, min: 256, step: 32 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
  // https://docs.bfl.ai/api-reference/tasks/generate-an-image-with-flux1-[dev]
  {
    description:
      'Open-source R&D image generation model, efficiently optimized for non-commercial innovation research.',
    displayName: 'FLUX.1 [dev]',
    enabled: true,
    id: 'flux-dev',
    parameters: {
      cfg: { default: 3, max: 5, min: 1.5, step: 0.1 },
      height: { default: 768, max: 1440, min: 256, step: 32 },
      imageUrl: { default: null },
      prompt: { default: '' },
      seed: { default: null },
      steps: { default: 28, max: 50, min: 1 },
      width: { default: 1024, max: 1440, min: 256, step: 32 },
    },
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-01',
    type: 'image',
  },
];

export const allModels = [...imageModels];

export default allModels;
