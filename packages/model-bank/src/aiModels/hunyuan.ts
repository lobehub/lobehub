import type { AIChatModelCard, AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

// https://cloud.tencent.com/document/product/1823/130051
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
    settings: {
      extendParams: ['hy3ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 192_000,
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
    settings: {
      searchImpl: 'params',
    },
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
    settings: {
      extendParams: ['enableReasoning'],
    },
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
    settings: {
      extendParams: ['enableReasoning'],
    },
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
    settings: {
      extendParams: ['enableReasoning'],
    },
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
    settings: {
      extendParams: ['enableReasoning'],
    },
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
    contextWindowTokens: 256_000,
    description:
      'Kimi K2.6, as Kimi’s latest open-source model, delivers industry-leading (state-of-the-art) capabilities in coding, long-horizon task execution, and agent orchestration. K2.6 achieves breakthroughs in long-range coding tasks, demonstrating more reliable generalization across different programming languages (such as Rust, Go, and Python) and diverse task scenarios (including frontend development, DevOps, and performance optimization).',
    displayName: 'Kimi K2.6',
    id: 'kimi-k2.6',
    maxOutput: 256_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 6.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      extendParams: ['enableReasoning'],
    },
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
    contextWindowTokens: 256_000,
    description:
      'Kimi K2.5 is Kimi’s most versatile model to date, featuring a natively multimodal architecture. It supports both visual and text inputs, thinking and non-thinking modes, as well as conversational and agent-based tasks.',
    displayName: 'Kimi K2.5',
    id: 'kimi-k2.5',
    maxOutput: 256_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'A self-evolving large language model developed by MiniMax, featuring strong software engineering capabilities and professional office productivity skills. It supports complex agent interactions and end-to-end project delivery.',
    displayName: 'MiniMax-M2.7',
    id: 'minimax-m2.7',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'MiniMax-M2.5 achieves or sets new state-of-the-art performance across productivity scenarios such as programming, tool use and search, and office-related tasks.',
    displayName: 'MiniMax-M2.5',
    id: 'minimax-m2.5',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek-V4-Flash is a production-grade model purpose-built for high concurrency and low latency. It features a standard 1M context window across the lineup, delivering near-flagship reasoning performance and outstanding agent response efficiency at extremely low cost.',
    displayName: 'DeepSeek-V4-Flash',
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek-V4-Pro is a native multimodal flagship model with 1.6 trillion parameters. Powered by a novel CSA+HCA hybrid attention architecture, it represents the industry’s cutting edge in complex mathematical reasoning, long-horizon code engineering, and advanced agent collaboration.',
    displayName: 'DeepSeek-V4-Pro',
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3.2 is a 685B-parameter MoE (Mixture-of-Experts) model. It introduces a sparse attention architecture that improves efficiency in long-context processing and achieves GPT-5-level performance on reasoning benchmarks.',
    displayName: 'Deepseek-v3.2',
    id: 'deepseek-v3.2',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-02',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3.1-Terminus is a 685B-parameter MoE (Mixture-of-Experts) model. While retaining the core capabilities of its predecessor, it improves language consistency and agent-related performance, delivering more stable outputs compared to the previous version.',
    displayName: 'Deepseek-v3.1',
    id: 'deepseek-v3.1',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-23',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-R1-0528 is a 671B-parameter model. With architectural optimizations and upgraded training strategies, it delivers significant improvements over the previous version in code generation, long-context processing, and complex reasoning tasks.',
    displayName: 'Deepseek-r1-0528',
    id: 'deepseek-r1-0528',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3-0324 is a 671B-parameter MoE (Mixture-of-Experts) model. It demonstrates strong advantages in programming and technical capabilities, as well as in contextual understanding and long-form text processing.',
    displayName: 'Deepseek-v3-0324',
    id: 'deepseek-v3-0324',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-25',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
      video: true,
    },
    contextWindowTokens: 256_000,
    description:
      'VITA is a multimodal understanding model that supports analysis of video and image content. It can be used for tasks such as video structure parsing and image object detection.',
    displayName: 'YT-VITA',
    id: 'youtu-vita',
    maxOutput: 256_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-10',
    type: 'chat',
  },
];

const hunyuanImageModels: AIImageModelCard[] = [
  {
    description:
      'Based on the Hunyuan large model, it is capable of reasoning about image layout, composition, and brushwork, using world knowledge to infer commonsense visual scenes. It can also interpret complex semantics at the scale of thousands of characters, generate long-form textual content, complex comics, memes, and produce vivid and engaging educational illustrations.',
    displayName: 'HY-Image-V3.0',
    enabled: true,
    id: 'hy-image-v3.0',
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
    releasedAt: '2026-03-10',
    type: 'image',
  },
  {
    description:
      'It adopts an ultra-high compression codec to enable fast image generation while maintaining high-quality output. It supports use cases such as e-commerce product image enhancement, design asset generation for creative tools, and iterative game scene development.',
    displayName: 'HY-Image-Lite',
    enabled: true,
    id: 'hy-image-lite',
    parameters: {
      height: { default: 1024, max: 4096, min: 160, step: 1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      width: { default: 1024, max: 4096, min: 160, step: 1 },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.099, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-12',
    type: 'image',
  },
];

const hunyuanVideoModels: AIVideoModelCard[] = [
  {
    description:
      'It supports multimodal inputs including text and images to generate high-quality videos, enabling scene transitions and multi-character interactions. It streamlines production workflows and reduces costs, making it suitable for enterprise advertising, marketing, and individual creative applications.',
    displayName: 'HY-Video-1.5',
    enabled: true,
    id: 'hy-video-1.5',
    parameters: {
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720p',
        enum: ['720p', '1080p'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1.5, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-01-06',
    type: 'video',
  },
  {
    description:
      'It generates highly temporally consistent videos from images, suitable for demanding applications such as advertising, film clips, and product showcase videos.',
    displayName: 'YT-Video-2.0',
    enabled: true,
    id: 'yt-video-2.0',
    parameters: {
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720p',
        enum: ['480p', '720p', '1080p'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 5, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-11-27',
    type: 'video',
  },
];

export const allModels = [...hunyuanChatModels, ...hunyuanImageModels, ...hunyuanVideoModels];

export default allModels;
