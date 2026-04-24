import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://cloud.tencent.com/document/product/1729/104753
const hunyuanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Hunyuan Hy3 Preview is designed for agent workloads, adopting a Mixture-of-Experts (MoE) architecture with 295B total parameters and 21B activated parameters. It offers three modes within a single model—**no_think** (ultra-fast response), **think_low** (quick reasoning), and **think_high** (deep reasoning)—to accommodate varying latency and depth requirements, from high-frequency interactions to complex engineering tasks. It achieves near state-of-the-art performance on coding benchmarks such as SWE-bench Verified, and supports a 256K context window for cross-file code refactoring and long-document analysis. This model is well-suited for developers who require reliable task completion while remaining sensitive to inference cost.',
    displayName: 'Hy3 preview',
    enabled: true,
    id: 'hy3-preview',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.016]': 0.4,
              '[0.016, 0.032]': 0.6,
              '[0.032, infinity]': 0.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.016]': 1.2,
              '[0.016, 0.032]': 1.6,
              '[0.032, infinity]': 2,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.016]': 4,
              '[0.016, 0.032]': 6.4,
              '[0.032, infinity]': 8,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Specialized in creative content, multi-turn interactions, and practical instruction-following scenarios. Significantly enhanced capabilities in mathematics, coding, and agent-based tasks.',
    displayName: 'HY 2.0 Think',
    enabled: true,
    id: 'hunyuan-2.0-thinking-20251109',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.975,
              '[0.032, infinity]': 5.3,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 15.9,
              '[0.032, infinity]': 21.2,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'The model foundation has been comprehensively upgraded, with more robust core capabilities. It achieves top-tier performance in knowledge, mathematics, writing, and reasoning. It also demonstrates excellent performance in instruction following, multi-turn interactions, and long-context comprehension.',
    displayName: 'HY 2.0 Instruct',
    enabled: true,
    id: 'hunyuan-2.0-instruct-20251111',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.18,
              '[0.032, infinity]': 4.505,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 7.95,
              '[0.032, infinity]': 11.13,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-11',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'For role-playing scenarios, it delivers highly consistent character alignment and exceptionally natural, human-like conversational style. It offers engaging narrative development and progression, along with emotional companionship and fulfillment.',
    displayName: 'Hunyuan-role',
    id: 'hunyuan-role-latest',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-04',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5.1 is Zhipu’s latest flagship model, with significantly enhanced coding capabilities and substantial improvements in long-horizon tasks. It can operate continuously and autonomously for up to 8 hours within a single task, completing a full closed loop from planning and execution to iterative optimization, delivering engineering-grade results. In terms of overall capabilities and coding performance, GLM-5.1 is aligned with Claude Opus 4.6. It demonstrates stronger sustained execution in long-running tasks, complex engineering optimization, and real-world development scenarios, making it an ideal foundation for building autonomous agents and long-horizon coding agents.',
    displayName: 'GLM-5.1',
    id: 'glm-5.1',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.3,
              '[0.032, infinity]': 2,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, infinity]': 8,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 24,
              '[0.032, infinity]': 28,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-08',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 200_000,
    description:
      'A model deeply optimized for real-world, long-chain agent tasks, with a focus on improving complex instruction decomposition, tool usage, scheduled continuous execution, and long-task stability.',
    displayName: 'GLM-5-Turbo',
    id: 'glm-5-turbo',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, infinity]': 1.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 5,
              '[0.032, infinity]': 7,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 22,
              '[0.032, infinity]': 26,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-16',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5 is Zhipu’s new-generation flagship foundation model, designed for agentic engineering. It excels at complex systems engineering, long-horizon agent tasks, and programming, achieving state-of-the-art (SOTA) performance among open-source models in both coding and agent capabilities.',
    displayName: 'GLM-5',
    id: 'glm-5',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1,
              '[0.032, infinity]': 1.5,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 4,
              '[0.032, infinity]': 6,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 18,
              '[0.032, infinity]': 22,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5V-Turbo is Zhipu’s first multimodal coding foundation model, designed for vision-based programming tasks. It natively handles multimodal inputs such as images, videos, and text, while excelling in long-horizon planning, complex programming, and action execution. Deeply optimized for agent workflows, it can collaborate seamlessly with agents like Claude Code and OpenClaw.',
    displayName: 'GLM-5V-Turbo',
    id: 'glm-5v-turbo',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, infinity]': 1.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 5,
              '[0.032, infinity]': 7,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 22,
              '[0.032, infinity]': 26,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-02',
    type: 'chat',
  },
];

const hunyuanImageModels: AIImageModelCard[] = [
  {
    description:
      'Powerful original-image feature extraction and detail preservation capabilities, delivering richer visual texture and producing high-accuracy, well-composed, production-grade visuals.',
    displayName: 'HY-Image-V3.0',
    enabled: true,
    id: 'HY-Image-V3.0',
    parameters: {
      height: { default: 1024, max: 2048, min: 512, step: 1 },
      imageUrls: { default: [], maxCount: 3 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 2048, min: 512, step: 1 },
      promptExtend: { default: false },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-26',
    type: 'image',
  },
];

export const allModels = [...hunyuanChatModels, ...hunyuanImageModels];

export default allModels;
