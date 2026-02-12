import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// price: https://bigmodel.cn/pricing
// ref: https://docs.bigmodel.cn/cn/guide/start/model-overview

const zhipuChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration. It achieves leading performance among open-source models on multiple public benchmarks. General capabilities are improved with more concise and natural responses and more immersive writing. For complex agent tasks, instruction following during tool calls is stronger, and the frontend aesthetics and long-term task completion efficiency of Artifacts and Agentic Coding are further enhanced.",
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'glm-4.7',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.4,
              '[0, 0.032]_[0.0002, infinity]': 0.6,
              '[0.032, 0.2]': 0.8,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 3,
              '[0.032, 0.2]': 4,
            },
            pricingParams: ['textInput', 'textOutput'],
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
              '[0.032, 0.2]': 16,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-4.7-Flash, as a 30B-level SOTA model, offers a new choice that balances performance and efficiency. It enhances coding capabilities, long-term task planning, and tool collaboration for Agentic Coding scenarios, achieving leading performance among open-source models of the same size in multiple current benchmark leaderboards. In executing complex intelligent agent tasks, it has stronger instruction compliance during tool calls, and further improves the aesthetics of front-end and the efficiency of long-term task completion for Artifacts and Agentic Coding.',
    displayName: 'GLM-4.7-Flash',
    enabled: true,
    id: 'glm-4.7-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-4.7-Flash, as a 30B-level SOTA model, offers a new choice that balances performance and efficiency. It enhances coding capabilities, long-term task planning, and tool collaboration for Agentic Coding scenarios, achieving leading performance among open-source models of the same size in multiple current benchmark leaderboards. In executing complex intelligent agent tasks, it has stronger instruction compliance during tool calls, and further improves the aesthetics of front-end and the efficiency of long-term task completion for Artifacts and Agentic Coding.',
    displayName: 'GLM-4.7-FlashX',
    enabled: true,
    id: 'glm-4.7-flashx',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
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
      search: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Zhipu's latest flagship model GLM-4.6 (355B) fully surpasses its predecessors in advanced coding, long-text processing, reasoning, and agent capabilities. It particularly aligns with Claude Sonnet 4 in programming ability, becoming China's top Coding model.",
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.4,
              '[0, 0.032]_[0.0002, infinity]': 0.6,
              '[0.032, 0.2]': 0.8,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 3,
              '[0.032, 0.2]': 4,
            },
            pricingParams: ['textInput', 'textOutput'],
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
              '[0.032, 0.2]': 16,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Zhipu’s next-generation MoE vision reasoning model has 106B total parameters with 12B active, achieving SOTA among similarly sized open-source multimodal models across image, video, document understanding, and GUI tasks.',
    displayName: 'GLM-4.5V',
    enabled: true,
    id: 'glm-4.5v',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.4,
              '[0.032, infinity]': 0.8,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 2,
              '[0.032, infinity]': 4,
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
              '[0, 0.032]': 6,
              '[0.032, infinity]': 12,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Zhipu flagship model with a switchable thinking mode, delivering open-source SOTA overall and up to 128K context.',
    displayName: 'GLM-4.5',
    id: 'glm-4.5',
    maxOutput: 98_304,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.4,
              '[0, 0.032]_[0.0002, infinity]': 0.6,
              '[0.032, 0.128]': 0.8,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 3,
              '[0.032, 0.128]': 4,
            },
            pricingParams: ['textInput', 'textOutput'],
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
              '[0.032, 0.128]': 16,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5 fast edition, delivering strong performance with generation speeds up to 100 tokens/sec.',
    displayName: 'GLM-4.5-X',
    id: 'glm-4.5-x',
    maxOutput: 98_304,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.6,
              '[0, 0.032]_[0.0002, infinity]': 2.4,
              '[0.032, 0.128]': 3.2,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 8,
              '[0, 0.032]_[0.0002, infinity]': 12,
              '[0.032, 0.128]': 16,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 16,
              '[0, 0.032]_[0.0002, infinity]': 32,
              '[0.032, 0.128]': 64,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5 lightweight edition that balances performance and cost, with flexible hybrid thinking modes.',
    displayName: 'GLM-4.5-Air',
    id: 'glm-4.5-air',
    maxOutput: 98_304,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.16,
              '[0.032, 0.128]': 0.24,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.2,
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
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 6,
              '[0.032, 0.128]': 8,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      search: true,
    },
    contextWindowTokens: 131_072,
    description: 'GLM-4.5-Air fast edition with quicker responses for high-scale, high-speed use.',
    displayName: 'GLM-4.5-AirX',
    id: 'glm-4.5-airx',
    maxOutput: 98_304,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.6,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 4,
              '[0.032, 0.128]': 8,
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
              '[0, 0.032]_[0, 0.0002]': 12,
              '[0, 0.032]_[0.0002, infinity]': 16,
              '[0.032, 0.128]': 32,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-Thinking is the strongest known ~10B VLM, covering SOTA tasks like video understanding, image QA, subject solving, OCR, document and chart reading, GUI agents, frontend coding, and grounding. It even surpasses the 8x larger Qwen2.5-VL-72B on many tasks. With advanced RL, it uses chain-of-thought reasoning to improve accuracy and richness, outperforming traditional non-thinking models in both outcomes and explainability.',
    displayName: 'GLM-4.1V-Thinking-FlashX',
    id: 'glm-4.1v-thinking-flashx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-Thinking is the strongest known ~10B VLM, covering SOTA tasks like video understanding, image QA, subject solving, OCR, document and chart reading, GUI agents, frontend coding, and grounding. It even surpasses the 8x larger Qwen2.5-VL-72B on many tasks. With advanced RL, it uses chain-of-thought reasoning to improve accuracy and richness, outperforming traditional non-thinking models in both outcomes and explainability.',
    displayName: 'GLM-4.1V-Thinking-Flash',
    id: 'glm-4.1v-thinking-flash',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 16_384,
    description:
      'GLM-Zero-Preview delivers strong complex reasoning, excelling in logic, math, and programming.',
    displayName: 'GLM-Zero-Preview',
    id: 'glm-zero-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description: 'Reasoning model with strong reasoning for tasks that require deep inference.',
    displayName: 'GLM-Z1-Air',
    id: 'glm-z1-air',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 32_768,
    description: 'Ultra-fast reasoning with high reasoning quality.',
    displayName: 'GLM-Z1-AirX',
    id: 'glm-z1-airx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Fast and low-cost: Flash-enhanced with ultra-fast reasoning and higher concurrency.',
    displayName: 'GLM-Z1-FlashX',
    id: 'glm-z1-flashx',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-Z1 series provides strong complex reasoning, excelling in logic, math, and programming.',
    displayName: 'GLM-Z1-Flash',
    id: 'glm-z1-flash',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description: 'GLM-4-Flash is ideal for simple tasks: fastest and free.',
    displayName: 'GLM-4-Flash-250414',
    id: 'glm-4-flash-250414',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description: 'GLM-4-FlashX is an enhanced Flash version with ultra-fast reasoning.',
    displayName: 'GLM-4-FlashX-250414',
    id: 'glm-4-flashx',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_024_000,
    description:
      'GLM-4-Long supports ultra-long inputs for memory-style tasks and large-scale document processing.',
    displayName: 'GLM-4-Long',
    id: 'glm-4-long',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4-Air is a high-value option with performance close to GLM-4, fast speed, and lower cost.',
    displayName: 'GLM-4-Air-250414',
    id: 'glm-4-air-250414',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 8192,
    description:
      'GLM-4-AirX is a more efficient GLM-4-Air variant with up to 2.6x faster reasoning.',
    displayName: 'GLM-4-AirX',
    id: 'glm-4-airx',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4-Plus is a high-intelligence flagship with strong long-text and complex-task handling and upgraded overall performance.',
    displayName: 'GLM-4-Plus',
    id: 'glm-4-plus',
    maxOutput: 4095,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4-0520 is the latest model version, designed for highly complex and diverse tasks with excellent performance.',
    displayName: 'GLM-4-0520',
    id: 'glm-4-0520', // Deprecation date: December 30, 2025
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 4096,
    description:
      'GLM-4V-Flash focuses on efficient single-image understanding for fast analysis scenarios such as real-time or batch image processing.',
    displayName: 'GLM-4V-Flash',
    id: 'glm-4v-flash',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-09',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_000,
    description:
      'GLM-4V-Plus understands video and multiple images, suitable for multimodal tasks.',
    displayName: 'GLM-4V-Plus-0111',
    id: 'glm-4v-plus-0111',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description: 'GLM-4V provides strong image understanding and reasoning across visual tasks.',
    displayName: 'GLM-4V',
    id: 'glm-4v',
    maxOutput: 1024,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'CodeGeeX-4 is a powerful AI coding assistant that supports multilingual Q&A and code completion to boost developer productivity.',
    displayName: 'CodeGeeX-4',
    id: 'codegeex-4',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'CharGLM-4 is built for roleplay and emotional companionship, supporting ultra-long multi-turn memory and personalized dialogue.',
    displayName: 'CharGLM-4',
    id: 'charglm-4',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Emohaa is a mental health model with professional counseling abilities to help users understand emotional issues.',
    displayName: 'Emohaa',
    id: 'emohaa',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const zhipuImageModels: AIImageModelCard[] = [
  // https://bigmodel.cn/dev/api/image-model/cogview
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
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '768x1344', '864x1152', '1344x768', '1152x864', '1440x720', '720x1440'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-03-04',
    type: 'image',
  },
];

export const allModels = [...zhipuChatModels, ...zhipuImageModels];

export default allModels;
