import type { AIImageModelCard } from '../../types/aiModel';

export const siliconcloudImageModels: AIImageModelCard[] = [
  {
    description:
      'Kolors is a large-scale latent-diffusion text-to-image model by the Kuaishou Kolors team. Trained on billions of text-image pairs, it excels in visual quality, complex semantic accuracy, and Chinese/English text rendering, with strong Chinese content understanding and generation.',
    displayName: 'Kolors',
    id: 'Kwai-Kolors/Kolors',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'],
      },
    },
    releasedAt: '2024-07-06',
    type: 'image',
  },
  {
    description:
      'Qwen-Image is a 20B-parameter image generation foundation model from the Qwen team. It makes major gains in complex text rendering and precise image editing, especially for high-fidelity Chinese/English text. It supports multi-line and paragraph layouts while keeping typography coherent. Beyond text rendering, it supports a wide range of styles from photorealistic to anime, and advanced editing like style transfer, object add/remove, detail enhancement, text editing, and pose control, aiming to be a comprehensive visual creation foundation.',
    displayName: 'Qwen-Image',
    id: 'Qwen/Qwen-Image',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1328x1328',
        enum: ['1328x1328', '1584x1056', '1140x1472', '1664x928', '928x1664'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-04',
    type: 'image',
  },
  {
    description:
      'Qwen-Image-Edit-2509 is the latest editing version of Qwen-Image from the Qwen team. Built on the 20B Qwen-Image model, it extends strong text rendering into image editing for precise text edits. It uses a dual-control architecture, sending inputs to Qwen2.5-VL for semantic control and a VAE encoder for appearance control, enabling both semantic- and appearance-level editing. It supports local edits (add/remove/modify) and higher-level semantic edits like IP creation and style transfer while preserving semantics. It achieves SOTA results on multiple benchmarks.',
    displayName: 'Qwen-Image-Edit (2509)',
    id: 'Qwen/Qwen-Image-Edit-2509',
    parameters: {
      imageUrls: {
        default: [],
        maxCount: 3,
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-22',
    type: 'image',
  },
];
