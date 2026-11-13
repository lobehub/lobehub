import type { AIImageModelCard, AIVideoModelCard } from '../../types/aiModel';

export const zhipuImageModels: AIImageModelCard[] = [
  {
    description:
      'GLM-Image is Zhipu’s new flagship image generation model. The model was trained end-to-end on domestically produced chips and adopts an original hybrid architecture that combines autoregressive modeling with a diffusion decoder. This design enables strong global instruction understanding alongside fine-grained local detail rendering, overcoming long-standing challenges in generating knowledge-dense content such as posters, presentations, and educational diagrams. It represents an important exploration toward a new generation of “cognitive generative” technology paradigms, exemplified by Nano Banana Pro.',
    displayName: 'GLM-Image',
    enabled: true,
    id: 'glm-image',
    parameters: {
      prompt: {
        default: '',
      },
      resolution: {
        default: 'hd',
        enum: ['hd'],
      },
      size: {
        default: '1280x1280',
        enum: [
          '1280x1280',
          '1568x1056',
          '1056x1568',
          '1472x1088',
          '1088x1472',
          '1728x960',
          '960x1728',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.015, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-14',
    type: 'image',
  },
  {
    description:
      'CogView-4 is Zhipu’s first open-source text-to-image model that can generate Chinese characters. It improves semantic understanding, image quality, and Chinese/English text rendering, supports arbitrary-length bilingual prompts, and can generate images at any resolution within specified ranges.',
    displayName: 'CogView-4',
    enabled: true,
    id: 'cogview-4',
    parameters: {
      prompt: {
        default: '',
      },
      resolution: {
        default: 'standard',
        enum: ['hd', 'standard'],
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.01, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-03-04',
    type: 'image',
  },
  {
    description:
      'CogView-3-Flash is a free image generation model launched by Zhipu. It generates images that align with user instructions while achieving higher aesthetic quality scores. CogView-3-Flash is primarily used in fields such as artistic creation, design reference, game development, and virtual reality, helping users rapidly convert text descriptions into images.',
    displayName: 'CogView-3-Flash',
    enabled: true,
    id: 'cogview-3-flash',
    parameters: {
      prompt: {
        default: '',
      },
      resolution: {
        default: 'standard',
        enum: ['hd', 'standard'],
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
];

export const zhipuVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Vidu 2 is a video generation foundation model designed to balance speed and quality. It focuses on image-to-video generation and start–end frame control, supporting 4-second videos at 720P resolution. The generation speed is significantly improved while costs are substantially reduced. Image-to-video generation fixes previous color shift issues, delivering stable and controllable visuals suitable for e-commerce and similar applications. In addition, semantic understanding of start and end frames and consistency across multiple reference images have been enhanced, making it an efficient tool for large-scale content production in general entertainment, internet media, animated short dramas, and advertising.',
    displayName: 'Vidu 2 Reference',
    enabled: true,
    id: 'vidu2-reference',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      duration: { default: 4, enum: [4] },
      generateAudio: { default: true },
      imageUrls: {
        default: [],
        maxCount: 3,
      },
      prompt: { default: '' },
      size: {
        default: '1280x720',
        enum: ['1280x720'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1.25, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'Vidu 2 is a video generation foundation model designed to balance speed and quality. It focuses on image-to-video generation and start–end frame control, supporting 4-second videos at 720P resolution. The generation speed is significantly improved while costs are substantially reduced. Image-to-video generation fixes previous color shift issues, delivering stable and controllable visuals suitable for e-commerce and similar applications. In addition, semantic understanding of start and end frames and consistency across multiple reference images have been enhanced, making it an efficient tool for large-scale content production in general entertainment, internet media, animated short dramas, and advertising.',
    displayName: 'Vidu 2 Start End',
    enabled: true,
    id: 'vidu2-start-end',
    parameters: {
      duration: { default: 5, enum: [5] },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: ['1920x1080'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1.25, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'Vidu Q1 is Vidu’s next-generation video generation foundation model, focused on high-quality video creation. It produces content with fixed specifications of 5 seconds, 24 FPS, and 1080P resolution. Through deep optimization of visual clarity, the overall image quality and texture are significantly improved, while issues such as hand deformation and frame jitter are greatly reduced. The realistic style closely approaches real-world scenes, and 2D animation styles are preserved with high fidelity. Transitions between start and end frames are smoother, making it well suited for high-demand creative scenarios such as film production, advertising, and animated short dramas.',
    displayName: 'Vidu Q1 Start End',
    id: 'viduq1-start-end',
    parameters: {
      duration: { default: 5, enum: [5] },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: ['1920x1080'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2.5, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'Vidu 2 is a video generation foundation model designed to balance speed and quality. It focuses on image-to-video generation and start–end frame control, supporting 4-second videos at 720P resolution. The generation speed is significantly improved while costs are substantially reduced. Image-to-video generation fixes previous color shift issues, delivering stable and controllable visuals suitable for e-commerce and similar applications. In addition, semantic understanding of start and end frames and consistency across multiple reference images have been enhanced, making it an efficient tool for large-scale content production in general entertainment, internet media, animated short dramas, and advertising.',
    displayName: 'Vidu 2 Image',
    enabled: true,
    id: 'vidu2-image',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
      duration: { default: 5, enum: [5] },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: ['1920x1080'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1.25, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'Vidu Q1 is Vidu’s next-generation video generation foundation model, focused on high-quality video creation. It produces content with fixed specifications of 5 seconds, 24 FPS, and 1080P resolution. Through deep optimization of visual clarity, the overall image quality and texture are significantly improved, while issues such as hand deformation and frame jitter are greatly reduced. The realistic style closely approaches real-world scenes, and 2D animation styles are preserved with high fidelity. Transitions between start and end frames are smoother, making it well suited for high-demand creative scenarios such as film production, advertising, and animated short dramas.',
    displayName: 'Vidu Q1 Image',
    id: 'viduq1-image',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
      duration: { default: 5, enum: [5] },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: ['1920x1080'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2.5, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'Vidu Q1 is Vidu’s next-generation video generation foundation model, focused on high-quality video creation. It produces content with fixed specifications of 5 seconds, 24 FPS, and 1080P resolution. Through deep optimization of visual clarity, the overall image quality and texture are significantly improved, while issues such as hand deformation and frame jitter are greatly reduced. The realistic style closely approaches real-world scenes, and 2D animation styles are preserved with high fidelity. Transitions between start and end frames are smoother, making it well suited for high-demand creative scenarios such as film production, advertising, and animated short dramas.',
    displayName: 'Vidu Q1 Text',
    enabled: true,
    id: 'viduq1-text',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      duration: { default: 5, enum: [5] },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: ['1920x1080'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 2.5, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-06-18',
    type: 'video',
  },
  {
    description:
      'CogVideoX-3 adds a start-and-end frame generation feature, significantly improving visual stability and clarity. It enables smooth and natural large-scale subject motion, offers better instruction adherence and more realistic physical simulation, and further enhances performance in high-definition realistic and 3D-style scenes.',
    displayName: 'CogVideoX-3',
    enabled: true,
    id: 'cogvideox-3',
    parameters: {
      duration: { default: 5, enum: [5, 10] },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: 'speed',
        enum: ['speed', 'quality'],
      },
      size: {
        default: '1920x1080',
        enum: [
          '1280x720',
          '720x1280',
          '1024x1024',
          '1920x1080',
          '1080x1920',
          '2048x1080',
          '3840x2160',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.2, strategy: 'fixed', unit: 'video' }],
    },
    releasedAt: '2025-07-15',
    type: 'video',
  },
  {
    description:
      'CogVideoX-2 is Zhipu’s new-generation video generation foundation model, with image-to-video capabilities improved by 38%. It delivers significant enhancements in large-scale motion handling, visual stability, instruction adherence, artistic style, and overall visual aesthetics.',
    displayName: 'CogVideoX-2',
    id: 'cogvideox-2',
    parameters: {
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: 'speed',
        enum: ['speed', 'quality'],
      },
      size: {
        default: '1920x1080',
        enum: [
          '720x480',
          '1024x1024',
          '1280x960',
          '960x1280',
          '1920x1080',
          '1080x1920',
          '2048x1080',
          '3840x2160',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'CogVideoX-Flash is a free video generation model released by Zhipu, capable of generating videos that follow user instructions while achieving higher aesthetic quality scores.',
    displayName: 'CogVideoX-Flash',
    enabled: true,
    id: 'cogvideox-flash',
    parameters: {
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: 'speed',
        enum: ['speed', 'quality'],
      },
      size: {
        default: '1920x1080',
        enum: [
          '720x480',
          '1024x1024',
          '1280x960',
          '960x1280',
          '1920x1080',
          '1080x1920',
          '2048x1080',
          '3840x2160',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
];
