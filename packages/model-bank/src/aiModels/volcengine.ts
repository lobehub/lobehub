import {
  PRESET_VIDEO_ASPECT_RATIOS,
  PRESET_VIDEO_RESOLUTIONS,
  type VideoModelParamsSchema,
} from '../standard-parameters/video';
import {
  type AIChatModelCard,
  type AIImageModelCard,
  type AIVideoModelCard,
} from '../types/aiModel';

// https://www.volcengine.com/docs/82379/1330310

const seedance20Params: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  duration: { default: 5, max: 15, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrls: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: [],
    height: { max: 6000, min: 300 },
    maxCount: 9,
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: PRESET_VIDEO_RESOLUTIONS,
  },
  seed: { default: null },
};

const seedance15ProParams: VideoModelParamsSchema = {
  aspectRatio: {
    default: 'adaptive',
    enum: ['adaptive', ...PRESET_VIDEO_ASPECT_RATIOS],
  },
  cameraFixed: { default: false },
  duration: { default: 5, max: 12, min: 4 },
  endImageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    requiresImageUrl: true,
    width: { max: 6000, min: 300 },
  },
  generateAudio: { default: true },
  imageUrl: {
    aspectRatio: { max: 2.5, min: 0.4 },
    default: null,
    height: { max: 6000, min: 300 },
    maxFileSize: 30 * 1024 * 1024,
    width: { max: 6000, min: 300 },
  },
  prompt: { default: '' },
  resolution: {
    default: '720p',
    enum: PRESET_VIDEO_RESOLUTIONS,
  },
  seed: { default: null },
};

const doubaoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    config: {
      deploymentName: 'deepseek-v4-pro-260425',
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Pro is DeepSeek’s flagship MoE model on Volcano Ark, supporting both non-thinking and thinking modes for advanced reasoning, code generation, and complex agent workflows.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    config: {
      deploymentName: 'deepseek-v4-flash-260425',
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Flash is DeepSeek’s efficient 1M-context model on Volcano Ark, balancing speed and cost while keeping strong reasoning and agent capabilities.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-pro-260215',
    },
    contextWindowTokens: 256_000,
    description:
      "Doubao-Seed-2.0-pro is ByteDance's flagship Agent general model, with all-around leaps in complex task planning and execution capabilities.",
    displayName: 'Doubao Seed 2.0 Pro',
    enabled: true,
    family: 'doubao',
    generation: 'doubao-2.0',
    id: 'doubao-seed-2.0-pro',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.2,
              '[0.032, 0.128]': 4.8,
              '[0.128, 0.256]': 9.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 16,
              '[0.032, 0.128]': 24,
              '[0.128, 0.256]': 48,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-lite-260428',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-lite is a new multimodal deep-reasoning model that delivers better value and a strong choice for common tasks, with a context window up to 256k.',
    displayName: 'Doubao Seed 2.0 Lite',
    enabled: true,
    family: 'doubao',
    generation: 'doubao-2.0',
    id: 'doubao-seed-2.0-lite',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.6,
              '[0.032, 0.128]': 0.9,
              '[0.128, 0.256]': 1.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.6,
              '[0.032, 0.128]': 5.4,
              '[0.128, 0.256]': 10.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-mini-260428',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-mini is a lightweight model with fast response and high performance, suitable for small tasks and high-concurrency scenarios.',
    displayName: 'Doubao Seed 2.0 Mini',
    family: 'doubao',
    generation: 'doubao-2.0',
    id: 'doubao-seed-2.0-mini',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.2,
              '[0.032, 0.128]': 0.4,
              '[0.128, 0.256]': 0.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 2,
              '[0.032, 0.128]': 4,
              '[0.128, 0.256]': 8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-2-0-code-preview-260215',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-2.0-code is deeply optimized for agentic coding, supports multimodal inputs and a 256k context window, fitting coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed 2.0 Code',
    family: 'doubao',
    generation: 'doubao-2.0',
    id: 'doubao-seed-2.0-code',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.2,
              '[0.032, 0.128]': 4.8,
              '[0.128, 0.256]': 9.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 16,
              '[0.032, 0.128]': 24,
              '[0.128, 0.256]': 48,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-8-251228',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.8 has stronger multimodal understanding and Agent capabilities, supports text/image/video input and context caching, and can deliver excellent performance in complex tasks.',
    displayName: 'Doubao Seed 1.8',
    family: 'doubao',
    generation: 'doubao-1.8',
    id: 'doubao-seed-1.8',
    maxOutput: 64_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.2,
              '[0.128, 0.256]': 2.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 8,
              '[0.032, 0.128]_[0, infinity]': 16,
              '[0.128, 0.256]_[0, infinity]': 24,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-18',
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-code-preview-251028',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code is deeply optimized for agentic coding, supports multimodal inputs (text/image/video) and a 256k context window, is compatible with the Anthropic API, and fits coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed Code',
    family: 'doubao',
    id: 'doubao-seed-code',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, 0.128]': 1.4,
              '[0.128, 0.256]': 2.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 12,
              '[0.128, 0.256]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'glm-4-7-251222',
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-4.7 is the latest flagship model from Zhipu AI. GLM-4.7 enhances coding capabilities, long-term task planning, and tool collaboration for Agentic Coding scenarios, achieving leading performance among open-source models in multiple public benchmarks. General capabilities are improved, with more concise and natural responses, and more immersive writing. In complex agent tasks, instruction following is stronger during tool calls, and the aesthetics of Artifacts and Agentic Coding frontend, as well as long-term task completion efficiency, are further enhanced. • Stronger programming capabilities: Significantly improved multi-language coding and terminal agent performance; GLM-4.7 can now implement "think first, then act" mechanisms in programming frameworks like Claude Code, Kilo Code, TRAE, Cline, and Roo Code, with more stable performance on complex tasks. • Frontend aesthetics improvement: GLM-4.7 shows significant progress in frontend generation quality, capable of generating websites, PPTs, and posters with better visual appeal. • Stronger tool calling capabilities: GLM-4.7 enhances tool calling abilities, scoring 67 in BrowseComp web task evaluation; achieving 84.7 in τ²-Bench interactive tool calling evaluation, surpassing Claude Sonnet 4.5 as the open-source SOTA. • Reasoning capability improvement: Significantly enhanced math and reasoning abilities, scoring 42.8% in the HLE ("Humanity\'s Last Exam") benchmark, a 41% improvement over GLM-4.6, surpassing GPT-5.1. • General capability enhancement: GLM-4.7 conversations are more concise, intelligent, and humane; writing and role-playing are more literary and immersive.',
    displayName: 'GLM-4.7',
    family: 'glm',
    generation: 'glm-4',
    id: 'glm-4-7',
    maxOutput: 128_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 3,
              '[0.032, 0.2]_[0, infinity]': 4,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 8,
              '[0, 0.032]_[0.0002, infinity]': 14,
              '[0.032, 0.2]_[0, infinity]': 16,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.4,
              '[0, 0.032]_[0.0002, infinity]': 0.6,
              '[0.032, 0.2]_[0, infinity]': 0.8,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: { prices: { '1h': 0.017 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
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
    config: {
      deploymentName: 'deepseek-v3-2-251201',
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3.2 is the first hybrid reasoning model from DeepSeek that integrates thinking into tool usage. It uses efficient architecture to save computation, large-scale reinforcement learning to enhance capabilities, and large-scale synthetic task data to strengthen generalization. The combination of these three achieves performance comparable to GPT-5-High, with significantly reduced output length, notably decreasing computational overhead and user wait times.',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    generation: 'deepseek-v3.2',
    id: 'deepseek-v3.2',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 2,
              '[0.032, 0.128]': 4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3,
              '[0.032, 0.128]': 6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-vision-250815',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-vision is a visual deep-reasoning model that delivers stronger multimodal understanding and reasoning for education, image review, inspection/security, and AI search Q&A. It supports a 256k context window and up to 64k output tokens.',
    displayName: 'Doubao Seed 1.6 Vision',
    family: 'doubao',
    generation: 'doubao-1.6',
    id: 'doubao-seed-1.6-vision',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 2.4,
              '[0.128, infinity]': 4.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 16,
              '[0.128, infinity]': 24,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-251015',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6 is a new multimodal deep-reasoning model with auto, thinking, and non-thinking modes. In non-thinking mode, it significantly outperforms Doubao-1.5-pro/250115. It supports a 256k context window and up to 16k output tokens.',
    displayName: 'Doubao Seed 1.6',
    family: 'doubao',
    generation: 'doubao-1.6',
    id: 'doubao-seed-1.6',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.2,
              '[0.128, infinity]': 2.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 8,
              '[0.032, 0.128]_[0, infinity]': 16,
              '[0.128, infinity]_[0, infinity]': 24,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
      search: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-flash-250828',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-flash is an ultra-fast multimodal deep-reasoning model with TPOT as low as 10ms. It supports both text and vision, surpasses the previous lite model in text understanding, and matches competing pro models in vision. It supports a 256k context window and up to 16k output tokens.',
    displayName: 'Doubao Seed 1.6 Flash',
    family: 'doubao',
    generation: 'doubao-1.6',
    id: 'doubao-seed-1.6-flash',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.15,
              '[0.032, 0.128]': 0.3,
              '[0.128, infinity]': 0.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.5,
              '[0.032, 0.128]': 3,
              '[0.128, infinity]': 6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'doubao-1-5-pro-32k-250115',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-pro is a new-generation flagship model with across-the-board upgrades, excelling in knowledge, coding, and reasoning.',
    displayName: 'Doubao 1.5 Pro 32k',
    family: 'doubao',
    generation: 'doubao-1.5',
    id: 'doubao-1.5-pro-32k',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'doubao-1-5-pro-256k-250115',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-1.5-pro-256k is a comprehensive upgrade to Doubao-1.5-Pro, improving overall performance by 10%. It supports a 256k context window and up to 12k output tokens, delivering higher performance, a larger window, and strong value for broader use cases.',
    displayName: 'Doubao 1.5 Pro 256k',
    family: 'doubao',
    generation: 'doubao-1.5',
    id: 'doubao-1.5-pro-256k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'doubao-1-5-lite-32k-250115',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-1.5-lite is a new lightweight model with ultra-fast response, delivering top-tier quality and latency.',
    displayName: 'Doubao 1.5 Lite 32k',
    family: 'doubao',
    generation: 'doubao-1.5',
    id: 'doubao-1.5-lite-32k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-pro-32k-250115',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-1.5-vision-pro is an upgraded multimodal model that supports images at any resolution and extreme aspect ratios, enhancing visual reasoning, document recognition, detail understanding, and instruction following.',
    displayName: 'Doubao 1.5 Vision Pro 32k',
    family: 'doubao',
    generation: 'doubao-1.5',
    id: 'doubao-1.5-vision-pro-32k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-15',
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'doubao-lite-32k-240828',
    },
    contextWindowTokens: 32_768,
    description:
      'Ultra-fast response with better value, offering more flexible choices across scenarios. Supports reasoning and fine-tuning with a 32k context window.',
    displayName: 'Doubao Lite 32k',
    family: 'doubao',
    id: 'doubao-lite-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'doubao-pro-32k-241215',
    },
    contextWindowTokens: 32_768,
    description:
      'The best-performing flagship model for complex tasks, with strong results in reference QA, summarization, creation, text classification, and roleplay. Supports reasoning and fine-tuning with a 32k context window.',
    displayName: 'Doubao Pro 32k',
    family: 'doubao',
    id: 'doubao-pro-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const volcengineImageModels: AIImageModelCard[] = [
  {
    description:
      'Doubao-Seedream-5.0-lite is ByteDance’s latest image-generation model. For the first time, it integrates online retrieval capabilities, allowing it to incorporate real-time web information and enhance the timeliness of generated images. The model’s intelligence has also been upgraded, enabling precise interpretation of complex instructions and visual content. Additionally, it offers improved global knowledge coverage, reference consistency, and generation quality in professional scenarios, better meeting enterprise-level visual creation needs.',
    displayName: 'Seedream 5.0 Lite',
    enabled: true,
    id: 'doubao-seedream-5-0-260128',
    parameters: {
      height: { default: 2048, max: 16_384, min: 480, step: 1 },
      imageUrls: { default: [], maxCount: 14, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      promptExtend: { default: 'off', enum: ['off', 'standard'] },
      watermark: { default: false },
      webSearch: { default: false },
      width: { default: 2048, max: 16_384, min: 480, step: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.22, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2026-01-28',
    type: 'image',
  },
  {
    description:
      'Seedream 4.5 is ByteDance’s latest multimodal image model, integrating text-to-image, image-to-image, and batch image generation capabilities, while incorporating commonsense and reasoning abilities. Compared to the previous 4.0 version, it delivers significantly improved generation quality, with better editing consistency and multi-image fusion. It offers more precise control over visual details, producing small text and small faces more naturally, and achieves more harmonious layout and color, enhancing overall aesthetics.',
    displayName: 'Seedream 4.5',
    enabled: true,
    id: 'doubao-seedream-4-5-251128',
    parameters: {
      height: { default: 2048, max: 16_384, min: 480, step: 1 },
      imageUrls: { default: [], maxCount: 14, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      promptExtend: { default: 'off', enum: ['off', 'standard'] },
      watermark: { default: false },
      width: { default: 2048, max: 16_384, min: 480, step: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.25, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-11-28',
    type: 'image',
  },
  {
    description:
      'Seedream 4.0 is an image generation model from ByteDance Seed, supporting text and image inputs with highly controllable, high-quality image generation. It generates images from text prompts.',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'doubao-seedream-4-0-250828',
    parameters: {
      height: { default: 2048, max: 16_384, min: 240, step: 1 },
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      promptExtend: { default: 'off', enum: ['off', 'standard', 'fast'] },
      watermark: { default: false },
      width: { default: 2048, max: 16_384, min: 240, step: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-09',
    type: 'image',
  },
];

const volcengineVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Seedance 2.0 by ByteDance is the most powerful video generation model, supporting multimodal reference video generation, video editing, video extension, text-to-video, and image-to-video with synchronized audio.',
    displayName: 'Seedance 2.0',
    enabled: true,
    id: 'doubao-seedance-2-0-260128',
    organization: 'ByteDance',
    parameters: {
      ...seedance20Params,
      watermark: { default: false },
      webSearch: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 37, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Seedance 2.0 Fast by ByteDance offers the same capabilities as Seedance 2.0 with faster generation speeds at a more competitive price.',
    displayName: 'Seedance 2.0 Fast',
    enabled: true,
    id: 'doubao-seedance-2-0-fast-260128',
    organization: 'ByteDance',
    parameters: {
      ...seedance20Params,
      watermark: { default: false },
      webSearch: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 46, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2026-01-28',
    type: 'video',
  },
  {
    description:
      'Seedance 1.5 Pro by ByteDance supports text-to-video, image-to-video (first frame, first+last frame), and audio generation synchronized with visuals.',
    displayName: 'Seedance 1.5 Pro',
    enabled: true,
    id: 'doubao-seedance-1-5-pro-251215',
    organization: 'ByteDance',
    parameters: {
      ...seedance15ProParams,
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            pricingParams: ['generateAudio'],
            prices: { false: 8, true: 16 },
          },
          name: 'videoGeneration',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-15',
    type: 'video',
  },
  {
    description:
      'Seedance 1.0 Pro Fast is a comprehensive model designed to minimize cost while maximizing performance, achieving an excellent balance between video generation quality, speed, and price. It inherits the core strengths of Seedance 1.0 Pro, while offering faster generation speeds and more competitive pricing, delivering creators a dual optimization of efficiency and cost.',
    displayName: 'Seedance 1.0 Pro Fast',
    id: 'doubao-seedance-1-0-pro-fast-251015',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1.1', '3:4', '9:16'],
      },
      cameraFixed: { default: false },
      duration: { default: 5, max: 12, min: 2 },
      imageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        width: { max: 6000, min: 300 },
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['480p', '720p', '1080p'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2025-10-15',
    type: 'video',
  },
  {
    description:
      'Seedance 1.0 Pro is a video generation foundation model that supports multi-shot storytelling. It delivers strong performance across multiple dimensions. The model achieves breakthroughs in semantic understanding and instruction following, enabling it to generate 1080P high-definition videos with smooth motion, rich details, diverse styles, and cinematic-level visual aesthetics.',
    displayName: 'Seedance 1.0 Pro',
    id: 'doubao-seedance-1-0-pro-250528',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['21:9', '16:9', '4:3', '1.1', '3:4', '9:16'],
      },
      cameraFixed: { default: false },
      duration: { default: 5, max: 12, min: 2 },
      endImageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        requiresImageUrl: true,
        width: { max: 6000, min: 300 },
      },
      imageUrl: {
        aspectRatio: { max: 2.5, min: 0.4 },
        default: null,
        height: { max: 6000, min: 300 },
        maxFileSize: 30 * 1024 * 1024,
        width: { max: 6000, min: 300 },
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['480p', '720p', '1080p'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    releasedAt: '2025-05-28',
    type: 'video',
  },
];

export const allModels = [...doubaoChatModels, ...volcengineImageModels, ...volcengineVideoModels];

export default allModels;
