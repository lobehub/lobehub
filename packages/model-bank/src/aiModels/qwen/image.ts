import type { AIImageModelCard } from '../../types/aiModel';

export const qwenImageModels: AIImageModelCard[] = [
  {
    description:
      'Z-Image is a lightweight text-to-image generation model that can rapidly produce images, supports both Chinese and English text rendering, and flexibly adapts to multiple resolutions and aspect ratios.',
    displayName: 'Z-Image Turbo',
    enabled: true,
    id: 'z-image-turbo',
    organization: 'Qwen',
    parameters: {
      height: { default: 1536, max: 4096, min: 256, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.015, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-19',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series full-version model integrates image generation and image editing into a unified capability. It supports more professional text rendering with up to 1k token instruction capacity, delivers more delicate and realistic visual textures, enables fine-grained depiction of realistic scenes, and demonstrates stronger semantic alignment with prompts. The full-version model provides the strongest text rendering capability and the highest level of realism within the 2.0 series.',
    displayName: 'Qwen Image 2.0 Pro 2026-04-22',
    id: 'qwen-image-2.0-pro-2026-04-22',
    enabled: true,
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 4096, min: 256, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.075, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-04-22',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series full-version model integrates image generation and image editing into a unified capability. It supports more professional text rendering with up to 1k token instruction capacity, delivers more delicate and realistic visual textures, enables fine-grained depiction of realistic scenes, and demonstrates stronger semantic alignment with prompts. The full-version model provides the strongest text rendering capability and the highest level of realism within the 2.0 series.',
    displayName: 'Qwen Image 2.0 Pro',
    id: 'qwen-image-2.0-pro',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 4096, min: 256, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.075, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series accelerated version model integrates image generation and image editing into a unified capability. It supports more professional text rendering with up to 1k token instruction capacity, provides more refined and realistic visual textures, enables fine-grained depiction of realistic scenes, and demonstrates stronger semantic adherence to prompts. The accelerated version effectively achieves the optimal balance between model quality and performance.',
    displayName: 'Qwen Image 2.0',
    id: 'qwen-image-2.0',
    enabled: true,
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 4096, min: 256, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 256, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-03-03',
    type: 'image',
  },
  {
    description:
      'Qwen Image Editing Model supports multi-image input and multi-image output, enabling precise in-image text editing, object addition, removal, or relocation, subject action modification, image style transfer, and enhanced visual detail.',
    displayName: 'Qwen Image Edit Max',
    id: 'qwen-image-edit-max',
    organization: 'Qwen',
    parameters: {
      height: { default: 1536, max: 2048, min: 512, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 2048, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.075, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-17',
    type: 'image',
  },
  {
    description:
      'Qwen Image Editing Model supports multi-image input and multi-image output, enabling precise in-image text editing, object addition, removal, or relocation, subject action modification, image style transfer, and enhanced visual detail.',
    displayName: 'Qwen Image Edit Plus',
    id: 'qwen-image-edit-plus',
    organization: 'Qwen',
    parameters: {
      height: { default: 1536, max: 2048, min: 512, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 2048, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-23',
    type: 'image',
  },
  {
    description:
      'Qwen Image Edit is an image-to-image model that edits images based on input images and text prompts, enabling precise adjustments and creative transformations.',
    displayName: 'Qwen Image Edit',
    id: 'qwen-image-edit',
    organization: 'Qwen',
    parameters: {
      imageUrl: {
        default: '',
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.045, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-18',
    type: 'image',
  },
  {
    description:
      'Qwen Image Generation Model (Max series) delivers enhanced realism and visual naturalness compared with the Plus series, effectively reducing AI-generated artifacts, and demonstrating outstanding performance in human appearance, texture details, and text rendering.',
    displayName: 'Qwen Image Max',
    id: 'qwen-image-max',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1664x928',
        enum: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.075, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-31',
    type: 'image',
  },
  {
    description:
      'It supports a wide range of artistic styles and is particularly proficient at rendering complex text within images, enabling integrated image–text layout design.',
    displayName: 'Qwen Image Plus',
    id: 'qwen-image-plus',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1664x928',
        enum: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-12',
    type: 'image',
  },
  {
    description:
      'Qwen-Image is a general image generation model supporting multiple art styles and strong complex text rendering, especially Chinese and English. It supports multi-line layouts, paragraph-level text, and fine detail for complex text-image layouts.',
    displayName: 'Qwen Image',
    id: 'qwen-image',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1328x1328',
        enum: ['1664x928', '1472x1140', '1328x1328', '1140x1472', '928x1664'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-13',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.7 Image Professional Edition, supports 4K high-definition output.',
    displayName: 'Wanxiang2.7 Image Pro',
    enabled: true,
    id: 'wan2.7-image-pro',
    organization: 'Qwen',
    parameters: {
      height: { default: 2048, max: 11_585, min: 271, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 2048, max: 11_585, min: 271, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.075, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-04-01',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.7 Image, faster image generation speed.',
    displayName: 'Wanxiang2.7 Image',
    enabled: true,
    id: 'wan2.7-image',
    organization: 'Qwen',
    parameters: {
      height: { default: 2048, max: 5792, min: 271, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 2048, max: 5792, min: 271, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-04-01',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.6 Image supports image editing and mixed image–text layout output.',
    displayName: 'Wanxiang2.6 Image',
    enabled: true,
    id: 'wan2.6-image',
    organization: 'Qwen',
    parameters: {
      height: { default: 1280, max: 2880, min: 640, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1280, max: 2880, min: 640, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-07-28',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.6 T2I supports flexible selection of image dimensions within total pixel area and aspect ratio constraints (same as Wanxiang 2.5).',
    displayName: 'Wanxiang2.6 T2I',
    enabled: true,
    id: 'wan2.6-t2i',
    organization: 'Qwen',
    parameters: {
      height: { default: 1280, max: 2880, min: 640, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1280, max: 2880, min: 640, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-16',
    type: 'image',
  },
  {
    description: 'Wanxiang 2.5 I2I Preview supports single-image editing and multi-image fusion.',
    displayName: 'Wanxiang2.5 I2I Preview',
    id: 'wan2.5-i2i-preview',
    organization: 'Qwen',
    parameters: {
      height: { default: 1280, max: 2560, min: 384, step: 1 },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1280, max: 2560, min: 384, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-23',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.5 T2I supports flexible selection of image dimensions within total pixel area and aspect ratio constraints.',
    displayName: 'Wanxiang2.5 T2I Preview',
    id: 'wan2.5-t2i-preview',
    organization: 'Qwen',
    parameters: {
      height: { default: 1280, max: 2880, min: 640, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1280, max: 2880, min: 640, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-23',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.2 Flash is the latest model with upgrades in creativity, stability, and realism, delivering fast generation and high value.',
    displayName: 'Wanxiang2.2 T2I Flash',
    id: 'wan2.2-t2i-flash',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-07-28',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.2 Plus is the latest model with upgrades in creativity, stability, and realism, producing richer details.',
    displayName: 'Wanxiang2.2 T2I Plus',
    id: 'wan2.2-t2i-plus',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-07-28',
    type: 'image',
  },
  {
    description:
      'Fully upgraded version with fast generation, strong overall quality, and high value. Corresponds to Tongyi Wanxiang 2.1 Speed.',
    displayName: 'Wanxiang2.1 T2I Turbo',
    id: 'wanx2.1-t2i-turbo',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-01-08',
    type: 'image',
  },
  {
    description:
      'Fully upgraded version with richer image details and slightly slower speed. Corresponds to Tongyi Wanxiang 2.1 Pro.',
    displayName: 'Wanxiang2.1 T2I Plus',
    id: 'wanx2.1-t2i-plus',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-01-08',
    type: 'image',
  },
  {
    description:
      'Excels at textured portraits with moderate speed and lower cost. Corresponds to Tongyi Wanxiang 2.0 Speed.',
    displayName: 'Wanxiang2.0 T2I Turbo',
    id: 'wanx2.0-t2i-turbo',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-01-17',
    type: 'image',
  },
  {
    description: 'Base text-to-image model. Corresponds to Tongyi Wanxiang 1.0 General.',
    displayName: 'Wanxiang v1',
    id: 'wanx-v1',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1440, min: 512, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 1440, min: 512, step: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.16, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-05-22',
    type: 'image',
  },
  {
    description:
      'Supports up to 10 reference images, allowing you to lock subjects, elements, and color tones to ensure consistent style. Combines style transfer, portrait/character referencing, multi-image fusion, and localized inpainting for flexible control. Delivers realistic portrait details, with overall visuals that are delicate and richly layered, featuring cinematic color and atmosphere.',
    displayName: 'Kling V3 Image Generation',
    enabled: true,
    id: 'kling/kling-v3-image-generation',
    organization: 'Qwen',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      imageUrl: {
        default: '',
      },
      prompt: {
        default: '',
      },
      resolution: {
        default: '1k',
        enum: ['1k', '2k'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-03-26',
    type: 'image',
  },
  {
    description:
      'Unlock cinematic storytelling visuals with new series image generation and direct 2K/4K output. Deeply analyzes audiovisual elements in prompts to precisely execute creative instructions. Supports flexible multi-reference inputs and comprehensive quality upgrades, ideal for storyboards, narrative concept art, and scene design.',
    displayName: 'Kling V3 Omni Image Generation',
    enabled: true,
    id: 'kling/kling-v3-omni-image-generation',
    organization: 'Qwen',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      imageUrls: {
        default: [],
      },
      prompt: {
        default: '',
      },
      resolution: {
        default: '1k',
        enum: ['1k', '2k', '4k'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-03-26',
    type: 'image',
  },
];
