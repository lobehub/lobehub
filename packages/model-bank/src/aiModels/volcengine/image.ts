import { type AIImageModelCard } from '../../types/aiModel';

/**
 * 2K presets shared by the Seedream 5.x cards. Every preset sits inside the
 * [921_600, 4_624_220] total-pixel range that Seedream 5.0 Pro / Flash accept and
 * above 2.61 MP, so each card bills one fixed 2K tier.
 * @see https://www.volcengine.com/docs/82379/1541523
 */
const seedream5Sizes = [
  '2048x2048',
  '2560x1440',
  '1440x2560',
  '2304x1728',
  '1728x2304',
  '2496x1664',
  '1664x2496',
];

/**
 * Volcengine retired doubao-seedream-4-0-250828, 4-5-251128 and 5-0-260128 on
 * 2026-11-24 (Ark deprecation batch 10), so they are no longer listed.
 * @see https://docs.volcengine.com/docs/ark/model-deprecation-notice
 */
export const volcengineImageModels: AIImageModelCard[] = [
  {
    description:
      'Seedream 5.5 is ByteDance’s latest image creation model, with multi-turn precise editing, native RGBA output and finer layer splitting. It supports text-to-image and up to 10 reference images.',
    displayName: 'Seedream 5.5',
    enabled: true,
    id: 'doubao-seedream-5-5-261028',
    parameters: {
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      size: { default: '2048x2048', enum: seedream5Sizes },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'imageGeneration', rate: 0.23, strategy: 'fixed', unit: 'image' },
        { name: 'imageInput', rate: 0.05, strategy: 'fixed', unit: 'image' },
      ],
    },
    releasedAt: '2026-11-09',
    type: 'image',
  },
  {
    description:
      'Seedream 5.0 Pro is a high-precision image generation model with precise control over element placement. It supports text-to-image and image editing with up to 10 reference images at 2K resolution.',
    displayName: 'Seedream 5.0 Pro',
    enabled: true,
    id: 'doubao-seedream-5-0-pro-260628',
    parameters: {
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      promptExtend: { default: 'standard', enum: ['standard', 'fast'] },
      size: { default: '2048x2048', enum: seedream5Sizes },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'imageGeneration', rate: 0.6, strategy: 'fixed', unit: 'image' },
        /**
         * Volcengine bills the first reference image free and ¥0.02 for each one after it;
         * a fixed per-image rate cannot express that, so estimates run ¥0.02 high when
         * reference images are sent.
         */
        { name: 'imageInput', rate: 0.02, strategy: 'fixed', unit: 'image' },
      ],
    },
    releasedAt: '2026-06-28',
    type: 'image',
  },
  {
    description:
      'Seedream 5.0 Flash is a fast, low-cost Seedream 5.0 model for text-to-image, image-to-image, precise editing and transparent-background output at 2K resolution.',
    displayName: 'Seedream 5.0 Flash',
    enabled: true,
    id: 'doubao-seedream-5-0-flash-260915',
    parameters: {
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      size: { default: '2048x2048', enum: seedream5Sizes },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.12, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-09-15',
    type: 'image',
  },
  {
    description:
      'Seedream 4.0 (2026-04-15) is the current Seedream 4.0 revision, with better image quality and aesthetics, instruction following and portraits. It supports text and up to 14 reference images and outputs up to 4K.',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'doubao-seedream-4-0-20260415',
    parameters: {
      /**
       * Every width and height in [960, 4096] keeps the total pixels inside the
       * [921_600, 16_777_216] range and the aspect ratio within 1:16 that Seedream 4.0
       * accepts, so the form cannot build a size the API rejects.
       */
      height: { default: 2048, max: 4096, min: 960, step: 1 },
      imageUrls: { default: [], maxCount: 14, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      promptExtend: { default: 'off', enum: ['off', 'standard', 'fast'] },
      watermark: { default: false },
      width: { default: 2048, max: 4096, min: 960, step: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-04-15',
    type: 'image',
  },
];
