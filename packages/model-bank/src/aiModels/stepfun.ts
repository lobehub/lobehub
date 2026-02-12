import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://platform.stepfun.com/docs/pricing/details

const stepfunChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 64_000,
    description:
      'This model has strong visual perception and complex reasoning, accurately handling cross-domain knowledge understanding, math-vision cross analysis, and a wide range of everyday visual analysis tasks.',
    displayName: 'Step 3',
    enabled: true,
    id: 'step-3',
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.5, upTo: 0.004 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 4, upTo: 0.004 },
            { rate: 8, upTo: 'infinity' }, // Still differs from documentation
          ],
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      // functionCall: true,
      reasoning: true,
      // search: true,
      vision: true,
    },
    contextWindowTokens: 100_000,
    description:
      'A reasoning model with strong image understanding that can process images and text, then generate text after deep reasoning. It excels at visual reasoning and delivers top-tier math, coding, and text reasoning, with a 100K context window.',
    displayName: 'Step R1 V Mini',
    id: 'step-r1-v-mini',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    // settings: {
    //   searchImpl: 'params',
    // },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 8000,
    description: 'Small model suited for lightweight tasks.',
    displayName: 'Step 1 8K',
    id: 'step-1-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 32_000,
    description: 'Supports mid-length conversations for a wide range of scenarios.',
    displayName: 'Step 1 32K',
    id: 'step-1-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 70, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 256_000,
    description: 'Extra-long context handling, ideal for long-document analysis.',
    displayName: 'Step 1 256K',
    id: 'step-1-256k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 300, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 8000,
    description:
      'Built on the next-generation in-house MFA attention architecture, delivering Step-1-like results at much lower cost while achieving higher throughput and faster latency. Handles general tasks with strong coding ability.',
    displayName: 'Step 2 Mini',
    enabled: true,
    id: 'step-2-mini',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-14',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 16_000,
    description: 'Supports large-context interactions for complex dialogues.',
    displayName: 'Step 2 16K',
    id: 'step-2-16k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Experimental Step-2 build with the latest features and rolling updates. Not recommended for production.',
    displayName: 'Step 2 16K Exp',
    id: 'step-2-16k-exp',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-15',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 8000,
    description: 'Small vision model for basic image-and-text tasks.',
    displayName: 'Step 1V 8K',
    id: 'step-1v-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    description: 'Supports vision inputs for richer multimodal interaction.',
    displayName: 'Step 1V 32K',
    id: 'step-1v-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 70, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Strong image understanding with better visual performance than the Step-1V series.',
    displayName: 'Step 1o Vision 32K',
    enabled: true,
    id: 'step-1o-vision-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 70, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-22',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Strong image understanding, outperforming 1o in math and coding. Smaller than 1o with faster output.',
    displayName: 'Step 1o Turbo Vision',
    enabled: true,
    id: 'step-1o-turbo-vision',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-14',
    type: 'chat',
  },
];

const stepfunImageModels: AIImageModelCard[] = [
  // https://platform.stepfun.com/docs/llm/image
  {
    description:
      'A new-generation StepFun image model focused on image generation, producing high-quality images from text prompts. It delivers more realistic texture and stronger Chinese/English text rendering.',
    displayName: 'Step 2X Large',
    enabled: true,
    id: 'step-2x-large',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['256x256', '512x512', '768x768', '1024x1024', '1280x800', '800x1280'],
      },
      steps: { default: 50, max: 100, min: 1 },
    },
    releasedAt: '2024-08-07',
    type: 'image',
  },
  {
    description:
      'This model offers strong image generation with text prompt input. With native Chinese support, it better understands Chinese descriptions, captures their semantics, and converts them into visual features for more accurate generation. It produces high-resolution, high-quality images and supports a degree of style transfer.',
    displayName: 'Step 1X Medium',
    enabled: true,
    id: 'step-1x-medium',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['256x256', '512x512', '768x768', '1024x1024', '1280x800', '800x1280'],
      },
      steps: { default: 50, max: 100, min: 1 },
    },
    releasedAt: '2025-07-15',
    type: 'image',
  },
  {
    description:
      'This model focuses on image editing, modifying and enhancing images based on user-provided images and text. It supports multiple input formats, including text descriptions and example images, and generates edits aligned with user intent.',
    displayName: 'Step 1X Edit',
    enabled: true,
    id: 'step-1x-edit',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['512x512', '768x768', '1024x1024'],
      },
      steps: { default: 28, max: 100, min: 1 },
    },
    releasedAt: '2025-03-04',
    type: 'image',
  },
];

export const allModels = [...stepfunChatModels, ...stepfunImageModels];

export default allModels;
