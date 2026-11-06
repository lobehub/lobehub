import type { AIVideoModelCard } from '../../types/aiModel';
import { qwenPartnerVideoModels } from './partnerVideo';

export const qwenVideoModels: AIVideoModelCard[] = [
  {
    description:
      'HappyHorse-1.0-I2V supports text-to-video generation, delivering highly faithful dynamic visuals. It can accurately understand textual semantics and produce high-quality videos that are smooth, natural, and rich in detail.',
    displayName: 'HappyHorse-1.0-I2V',
    enabled: true,
    id: 'happyhorse-1.0-i2v',
    parameters: {
      duration: { default: 5, max: 15, min: 3 },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-22',
    type: 'video',
  },
  {
    description:
      'HappyHorse-1.0-R2V supports reference-based video generation, offering more stable subject and scene consistency. It supports up to 9 reference images, accurately preserves creative intent, and delivers enhanced expressive capability.',
    displayName: 'HappyHorse-1.0-R2V',
    enabled: true,
    id: 'happyhorse-1.0-r2v',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      duration: { default: 5, max: 10, min: 3 },
      imageUrls: {
        default: [],
        maxCount: 9,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-26',
    type: 'video',
  },
  {
    description:
      'HappyHorse-1.0-T2V supports text-to-video generation, delivering highly faithful dynamic visuals. It can accurately understand textual semantics and produce high-quality videos that are smooth, natural, and rich in detail.',
    displayName: 'HappyHorse-1.0-T2V',
    enabled: true,
    id: 'happyhorse-1.0-t2v',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      duration: { default: 5, max: 15, min: 3 },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-21',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Image-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Combined with more dynamic and rhythmically driven shot transitions, it achieves stronger overall performance and storytelling.',
    displayName: 'Wan2.7 I2V 2026-04-25',
    enabled: true,
    id: 'wan2.7-i2v-2026-04-25',
    parameters: {
      duration: { default: 5, max: 15, min: 2 },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-26',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Image-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Combined with more dynamic and rhythmically driven shot transitions, it achieves stronger overall performance and storytelling.',
    displayName: 'Wan2.7 I2V',
    id: 'wan2.7-i2v',
    parameters: {
      duration: { default: 5, max: 15, min: 2 },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-03',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Reference-to-Video offers more stable references for characters, props, and scenes. It supports up to 5 mixed reference images or videos, along with audio tone referencing. Combined with upgraded core capabilities, it delivers stronger performance and expressive power.',
    displayName: 'Wan2.7 R2V',
    enabled: true,
    id: 'wan2.7-r2v',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      duration: { default: 5, max: 10, min: 2 },
      imageUrls: {
        default: [],
        maxCount: 5,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-03',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Text-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Enhanced with more dynamic and rhythmically driven shot transitions, it achieves stronger overall acting and storytelling performance.',
    displayName: 'Wan2.7 T2V 2026-04-25',
    enabled: true,
    id: 'wan2.7-t2v-2026-04-25',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      duration: { default: 5, max: 15, min: 2 },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-26',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Text-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Enhanced with more dynamic and rhythmically driven shot transitions, it achieves stronger overall acting and storytelling performance.',
    displayName: 'Wan2.7 T2V',
    id: 'wan2.7-t2v',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1', '4:3', '3:4'],
      },
      duration: { default: 5, max: 15, min: 2 },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-03',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 introduces multi-shot narrative capabilities, while also supporting automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.6 I2V Flash',
    id: 'wan2.6-i2v-flash',
    parameters: {
      duration: { default: 5, max: 15, min: 2 },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.075, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-01-17',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 introduces multi-shot narrative capabilities, while also supporting automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.6 I2V',
    id: 'wan2.6-i2v',
    parameters: {
      duration: { default: 5, max: 15, min: 2 },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 Reference-to-Video – Flash offers faster generation and better cost performance. It supports referencing specific characters or any objects, accurately maintaining consistency in appearance and voice, and enables multi-character reference for co-performance.',
    displayName: 'Wan2.6 R2V Flash',
    id: 'wan2.6-r2v-flash',
    parameters: {
      duration: { default: 5, max: 10, min: 2 },
      generateAudio: { default: true },
      imageUrls: {
        default: [],
        maxCount: 5,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: [
          '1280x720',
          '720x1280',
          '960x960',
          '1088x832',
          '832x1088',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1632x1248',
          '1248x1632',
        ],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.075, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 Reference-to-Video supports referencing specific characters or any objects, accurately maintaining consistency in appearance and voice, and enabling multi-character reference for co-performance. Note: When using videos as references, the input video will also be counted toward the cost. Please refer to the model pricing documentation for details.',
    displayName: 'Wan2.6 R2V',
    id: 'wan2.6-r2v',
    parameters: {
      duration: { default: 5, max: 10, min: 2 },
      imageUrls: {
        default: [],
        maxCount: 5,
      },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: [
          '1280x720',
          '720x1280',
          '960x960',
          '1088x832',
          '832x1088',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1632x1248',
          '1248x1632',
        ],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 introduces multi-shot narrative capabilities, while also supporting automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.6 T2V',
    id: 'wan2.6-t2v',
    parameters: {
      duration: { default: 5, max: 15, min: 2 },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: [
          '1280x720',
          '720x1280',
          '960x960',
          '1088x832',
          '832x1088',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1632x1248',
          '1248x1632',
        ],
      },
      seed: { default: null },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.5 Preview supports automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.5 I2V Preview',
    id: 'wan2.5-i2v-preview',
    parameters: {
      imageUrl: {
        default: null,
      },
      duration: { default: 5, enum: [5, 10] },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['480P', '720P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-09-23',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.5 Preview supports automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.5 T2V Preview',
    id: 'wan2.5-t2v-preview',
    parameters: {
      duration: { default: 5, enum: [5, 10] },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: [
          '848x480',
          '480x832',
          '624x624',
          '1280x720',
          '720x1280',
          '960x960',
          '1088x832',
          '832x1088',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1632x1248',
          '1248x1632',
        ],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-09-23',
    type: 'video',
  },
  {
    description: 'Wanxiang 2.2 Speed Edition',
    displayName: 'Wan2.2 KF2V Flash',
    id: 'wan2.2-kf2v-flash',
    parameters: {
      duration: { default: 5, enum: [5] },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['480P', '720P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.036, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-09-12',
    type: 'video',
  },
  {
    description: 'Wanxiang 2.2 Plus Edition',
    displayName: 'Wan2.2 KF2V Plus',
    id: 'wan2.2-kf2v-plus',
    parameters: {
      duration: { default: 5, enum: [5] },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.7, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-09-12',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.2 Speed Edition delivers ultra-fast generation, with more accurate prompt understanding and camera control. It maintains consistency of visual elements while significantly improving overall stability and success rate.',
    displayName: 'Wan2.2 I2V Flash',
    id: 'wan2.2-i2v-flash',
    parameters: {
      duration: { default: 5, enum: [5] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['480P', '720P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.036, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-08-11',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.2 Pro Edition offers more accurate prompt understanding and controllable camera movements. It maintains consistency of visual elements while significantly improving stability and success rate, and generates richer, more detailed content.',
    displayName: 'Wan2.2 I2V Plus',
    id: 'wan2.2-i2v-plus',
    parameters: {
      duration: { default: 5, enum: [5] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080P',
        enum: ['480P', '1080P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-07-28',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.2 Pro Edition provides more accurate prompt understanding, delivers stable and smooth motion generation, and produces richer, more detailed visuals.',
    displayName: 'Wan2.2 T2V Plus',
    id: 'wan2.2-t2v-plus',
    parameters: {
      duration: { default: 5, enum: [5] },
      prompt: { default: '' },
      size: {
        default: '1920x1080',
        enum: [
          '848x480',
          '480x832',
          '624x624',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1632x1248',
          '1248x1632',
        ],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-07-28',
    type: 'video',
  },
  {
    description: 'Wanxiang 2.1 Speed Edition offers high cost-performance.',
    displayName: 'Wanxiang2.1 I2V Turbo',
    id: 'wanx2.1-i2v-turbo',
    parameters: {
      duration: { default: 5, enum: [3, 4, 5] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['480P', '720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.036, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-02-25',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.1 Pro Edition delivers more visually refined and higher-quality imagery.',
    displayName: 'Wanxiang2.1 I2V Plus',
    id: 'wanx2.1-i2v-plus',
    parameters: {
      duration: { default: 5, enum: [5] },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P'],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-17',
    type: 'video',
  },
  {
    description: 'Wanxiang 2.1 Speed Edition offers excellent cost-performance.',
    displayName: 'Wanxiang2.1 T2V Turbo',
    id: 'wanx2.1-t2v-turbo',
    parameters: {
      duration: { default: 5, enum: [5] },
      prompt: { default: '' },
      size: {
        default: '1280x720',
        enum: [
          '848x480',
          '480x832',
          '624x624',
          '1280x720',
          '720x1280',
          '960x960',
          '1088x832',
          '832x1088',
        ],
      },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.036, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-08',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.1 Pro Edition delivers richer visual texture and higher-quality imagery.',
    displayName: 'Wanxiang2.1 T2V Plus',
    id: 'wanx2.1-t2v-plus',
    parameters: {
      duration: { default: 5, enum: [5] },
      prompt: { default: '' },
      promptExtend: { default: false },
      size: {
        default: '1280x720',
        enum: ['1280x720', '720x1280', '960x960', '1088x832', '832x1088'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'USD',
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-08',
    type: 'video',
  },
  ...qwenPartnerVideoModels,
];
