import type { AIVideoModelCard } from '../../types/aiModel';

export const siliconcloudVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Wan2.2-I2V-A14B is one of the first open-source image-to-video (I2V) generation models released by Wan-AI, an AI initiative under Alibaba, to adopt a Mixture of Experts (MoE) architecture. The model focuses on generating smooth and natural dynamic video sequences by combining static images with text prompts. Its core innovation lies in the MoE architecture: a high-noise expert is responsible for handling the coarse structure in the early stages of video generation, while a low-noise expert refines fine-grained details in the later stages. This design improves overall model performance without increasing inference cost. Compared to previous versions, Wan2.2 is trained on a significantly larger dataset, leading to notable improvements in understanding complex motion, aesthetic styles, and semantic content. It produces more stable videos and reduces unrealistic camera movements.',
    displayName: 'Wan-AI/Wan2.2-I2V-A14B',
    enabled: true,
    id: 'Wan-AI/Wan2.2-I2V-A14B',
    parameters: {
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      seed: { default: null },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Wan2.2-T2V-A14B is the first open-source video generation model released by Alibaba to adopt a Mixture of Experts (MoE) architecture. The model is designed for text-to-video (T2V) generation tasks and is capable of producing videos up to 5 seconds in length at resolutions of 480P or 720P. By introducing the MoE architecture, the model significantly increases its overall capacity while keeping inference costs nearly unchanged. It includes a high-noise expert that handles the global structure in the early stages of generation, and a low-noise expert that refines fine details in the later stages of the video. In addition, Wan2.2 incorporates carefully curated aesthetic data, with detailed annotations across dimensions such as lighting, composition, and color. This enables more precise and controllable generation of cinematic-quality visuals. Compared to previous versions, the model is trained on a larger dataset, resulting in significantly improved generalization in motion, semantics, and aesthetics, and better handling of complex dynamic effects.',
    displayName: 'Wan-AI/Wan2.2-T2V-A14B',
    enabled: true,
    id: 'Wan-AI/Wan2.2-T2V-A14B',
    parameters: {
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: ['1280x720', '720x1280', '960x960'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
];
