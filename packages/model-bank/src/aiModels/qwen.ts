import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://help.aliyun.com/zh/model-studio/models?spm=a2c4g.11186623

const qwenChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is the most capable Kimi model, delivering open-source SOTA in agent tasks, coding, and vision understanding. It supports multimodal inputs and both thinking and non-thinking modes.',
    displayName: 'Kimi K2.5',
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.1 is a flagship open-source large model from MiniMax, focusing on solving complex real-world tasks. Its core strengths are multi-language programming capabilities and the ability to solve complex tasks as an Agent.',
    displayName: 'MiniMax-M2.1',
    id: 'MiniMax-M2.1',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
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
      vision: true,
    },
    config: {
      deploymentName: 'qwen3-vl-plus-2025-12-19',
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen VL is a text generation model with vision understanding. It can do OCR and also summarize and reason, such as extracting attributes from product photos or solving problems from images.',
    displayName: 'Qwen3 VL Plus',
    id: 'qwen3-vl-plus',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1,
              '[0.032, 0.128]': 1.5,
              '[0.128, infinity]': 3,
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
              '[0, 0.032]': 10,
              '[0.032, 0.128]': 15,
              '[0.128, infinity]': 30,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-09-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3-vl-flash-2026-01-22',
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 VL Flash: lightweight, high-speed reasoning version for latency-sensitive or high-volume requests.',
    displayName: 'Qwen3 VL Flash',
    id: 'qwen3-vl-flash',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.15,
              '[0.032, 0.128]': 0.3,
              '[0.128, 0.256]': 0.6,
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
              '[0.128, 0.256]': 6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'deepseek-v3.2-exp introduces sparse attention to improve training and inference efficiency on long text, at a lower price than deepseek-v3.1.',
    displayName: 'DeepSeek V3.2 Exp',
    id: 'deepseek-v3.2-exp',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'DeepSeek V3.1 uses a hybrid reasoning architecture with both thinking and non-thinking modes.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'kimi-k2-thinking is a Moonshot AI thinking model with general agentic and reasoning abilities. It excels at deep reasoning and can solve hard problems via multi-step tool use.',
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-10',
    settings: {
      extendParams: ['reasoningBudgetToken'],
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
      '1T total parameters with 32B active. Among non-thinking models, it is top-tier in frontier knowledge, math, and coding, and stronger at general agent tasks. Optimized for agent workloads, it can take actions, not just answer questions. Best for improvisational, general chat, and agent experiences as a reflex-level model without long thinking.',
    displayName: 'Kimi K2 Instruct',
    id: 'Moonshot-Kimi-K2-Instruct',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-17',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 202_752,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3,
              '[0.032, infinity]': 4,
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
              '[0, 0.032]': 14,
              '[0.032, infinity]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.5 series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.5',
    id: 'glm-4.5',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3,
              '[0.032, infinity]': 4,
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
              '[0, 0.032]': 14,
              '[0.032, infinity]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'The GLM-4.5 series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.5-Air',
    id: 'glm-4.5-air',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, infinity]': 1.2,
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
              '[0, 0.032]': 6,
              '[0.032, infinity]': 8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'qwen3-coder-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen code model. The latest Qwen3-Coder series is based on Qwen3 and delivers strong coding-agent abilities, tool use, and environment interaction for autonomous programming, with excellent code performance and solid general capability.',
    displayName: 'Qwen3 Coder Plus',
    id: 'qwen3-coder-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 4 * 0.2,
              '[0.032, 0.128]': 6 * 0.2,
              '[0.128, 0.256]': 10 * 0.2,
              '[0.256, infinity]': 20 * 0.2,
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
              '[0.032, 0.128]': 6,
              '[0.128, 0.256]': 10,
              '[0.256, infinity]': 20,
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
              '[0.128, 0.256]': 40,
              '[0.256, infinity]': 200,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'qwen3-coder-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen code model. The latest Qwen3-Coder series is based on Qwen3 and delivers strong coding-agent abilities, tool use, and environment interaction for autonomous programming, with excellent code performance and solid general capability.',
    displayName: 'Qwen3 Coder Flash',
    id: 'qwen3-coder-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.2,
              '[0.032, 0.128]': 0.3,
              '[0.128, 0.256]': 0.5,
              '[0.256, 1]': 1,
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
              '[0, 0.032]': 1,
              '[0.032, 0.128]': 1.5,
              '[0.128, 0.256]': 2.5,
              '[0.256, 1]': 5,
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
              '[0, 0.032]': 4,
              '[0.032, 0.128]': 6,
              '[0.128, 0.256]': 10,
              '[0.256, 1]': 25,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Open-source Qwen code model. The latest qwen3-coder-480b-a35b-instruct is based on Qwen3 and delivers strong coding-agent abilities, tool use, and environment interaction for autonomous programming, with excellent code performance and solid general capability.',
    displayName: 'Qwen3 Coder 480B A35B',
    id: 'qwen3-coder-480b-a35b-instruct',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 9,
              '[0.128, 0.2]': 15,
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
              '[0, 0.032]': 24,
              '[0.032, 0.128]': 36,
              '[0.128, 0.2]': 60,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Open-source Qwen code model. The latest qwen3-coder-30b-a3b-instruct is based on Qwen3 and delivers strong coding-agent abilities, tool use, and environment interaction for autonomous programming, with excellent code performance and solid general capability.',
    displayName: 'Qwen3 Coder 30B A3B',
    id: 'qwen3-coder-30b-a3b-instruct',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.5,
              '[0.032, 0.128]': 2.25,
              '[0.128, 0.2]': 3.75,
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
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 9,
              '[0.128, 0.2]': 15,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 thinking-mode open-source model. Compared to the previous version (Qwen3-235B-A22B), it significantly improves logic, general ability, knowledge, and creativity, suitable for hard reasoning scenarios.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    enabled: true,
    id: 'qwen3-235b-a22b-thinking-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-25',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 non-thinking open-source model. Compared to the previous version (Qwen3-235B-A22B), it slightly improves subjective creativity and model safety.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    enabled: true,
    id: 'qwen3-235b-a22b-instruct-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-22',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 thinking-mode open-source model. Compared to the previous version (Qwen3-30B-A3B), it significantly improves logic, general ability, knowledge, and creativity, suitable for hard reasoning scenarios.',
    displayName: 'Qwen3 30B A3B Thinking 2507',
    id: 'qwen3-30b-a3b-thinking-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-30',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Compared to the previous version (Qwen3-30B-A3B), overall Chinese/English and multilingual general ability is significantly improved. Subjective open-ended tasks are specially optimized for stronger preference alignment and more helpful responses.',
    displayName: 'Qwen3 30B A3B Instruct 2507',
    id: 'qwen3-30b-a3b-instruct-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-29',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Next-gen Qwen3 thinking-mode open-source model. Compared to the prior version (Qwen3-235B-A22B-Thinking-2507), instruction following is improved and summaries are more concise.',
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'qwen3-next-80b-a3b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-12',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Next-gen Qwen3 non-thinking open-source model. Compared to the prior version (Qwen3-235B-A22B-Instruct-2507), it has better Chinese understanding, stronger logical reasoning, and improved text generation.',
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'qwen3-next-80b-a3b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 235B A22B',
    id: 'qwen3-235b-a22b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 32B',
    id: 'qwen3-32b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 30B A3B',
    id: 'qwen3-30b-a3b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 14B',
    id: 'qwen3-14b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 8B',
    id: 'qwen3-8b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 4B',
    id: 'qwen3-4b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 1.7B',
    id: 'qwen3-1.7b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capabilities, and multilingual performance, and supports switching thinking modes.',
    displayName: 'Qwen3 0.6B',
    id: 'qwen3-0.6b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      deploymentName: 'qwq-plus-2025-03-05',
    },
    contextWindowTokens: 131_072,
    description:
      'QwQ reasoning model trained on Qwen2.5 uses RL to greatly improve reasoning. Core metrics in math/code (AIME 24/25, LiveCodeBench) and some general benchmarks (IFEval, LiveBench) reach the full DeepSeek-R1 level.',
    displayName: 'QwQ Plus',
    id: 'qwq-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-05',
    settings: {
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
      deploymentName: 'qwen-flash',
    },
    contextWindowTokens: 1_000_000,
    description: 'Fastest and lowest-cost Qwen model, ideal for simple tasks.',
    displayName: 'Qwen Flash',
    enabled: true,
    id: 'qwen-flash',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.15, upTo: 0.128 },
            { rate: 0.6, upTo: 0.256 },
            { rate: 1.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.5, upTo: 0.128 },
            { rate: 6, upTo: 0.256 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.15 * 0.2, upTo: 0.128 },
            { rate: 0.6 * 0.2, upTo: 0.256 },
            { rate: 1.2 * 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-07-28',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      deploymentName: 'qwen-turbo-2025-07-15',
    },
    contextWindowTokens: 1_000_000, // Non-thinking mode
    description:
      'Qwen Turbo will no longer be updated; replace it with Qwen Flash. Ultra-large Qwen model supporting Chinese, English, and other languages.',
    displayName: 'Qwen Turbo',
    id: 'qwen-turbo',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-15',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      deploymentName: 'qwen-plus-2025-12-01',
    },
    contextWindowTokens: 1_000_000,
    description:
      'Enhanced ultra-large Qwen model supporting Chinese, English, and other languages.',
    displayName: 'Qwen Plus',
    enabled: true,
    id: 'qwen-plus',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.8 * 0.2,
              '[0.128, 0.256]': 2.4 * 0.2,
              '[0.256, infinity]': 4.8 * 0.2,
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
              '[0, 0.128]': 0.8,
              '[0.128, 0.256]': 2.4,
              '[0.256, infinity]': 4.8,
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
              '[0, 0.128]_[false]': 2,
              '[0, 0.128]_[true]': 8,
              '[0.128, 0.256]_[false]': 20,
              '[0.128, 0.256]_[true]': 24,
              '[0.256, infinity]_[false]': 48,
              '[0.256, infinity]_[true]': 64,
            },
            pricingParams: ['textInputRange', 'thinkingMode'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max models deliver large gains over the 2.5 series in general ability, Chinese/English understanding, complex instruction following, subjective open tasks, multilingual ability, and tool use, with fewer hallucinations. The latest qwen3-max improves agentic programming and tool use over qwen3-max-preview. This release reaches field SOTA and targets more complex agent needs.',
    displayName: 'Qwen3 Max Thinking',
    id: 'qwen3-max-2026-01-23',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 2.5,
              '[0.032, 0.128]': 4,
              '[0.128, 0.252]': 7,
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
              '[0, 0.032]': 10,
              '[0.032, 0.128]': 16,
              '[0.128, 0.252]': 28,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-01-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    config: {
      deploymentName: 'qwen3-max', // Supports context caching
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max models deliver large gains over the 2.5 series in general ability, Chinese/English understanding, complex instruction following, subjective open tasks, multilingual ability, and tool use, with fewer hallucinations. The latest qwen3-max improves agentic programming and tool use over qwen3-max-preview. This release reaches field SOTA and targets more complex agent needs.',
    displayName: 'Qwen3 Max',
    enabled: true,
    id: 'qwen3-max',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 3.2 * 0.2,
              '[0.032, 0.128]': 6.4 * 0.2,
              '[0.128, infinity]': 9.6 * 0.2,
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
              '[0, 0.032]': 3.2,
              '[0.032, 0.128]': 6.4,
              '[0.128, infinity]': 9.6,
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
              '[0, 0.032]': 12.8,
              '[0.032, 0.128]': 25.6,
              '[0.128, infinity]': 38.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-09-23',
    settings: {
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
      deploymentName: 'qwen3-max-preview', // Supports context caching
    },
    contextWindowTokens: 262_144,
    description:
      'Best-performing Qwen model for complex, multi-step tasks. The preview supports thinking.',
    displayName: 'Qwen3 Max Preview',
    id: 'qwen3-max-preview',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6 * 0.2,
              '[0.032, 0.128]': 10 * 0.2,
              '[0.128, infinity]': 15 * 0.2,
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
              '[0.032, 0.128]': 10,
              '[0.128, infinity]': 15,
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
              '[0, 0.032]': 24,
              '[0.032, 0.128]': 40,
              '[0.128, infinity]': 60,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-10-30',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    config: {
      deploymentName: 'qwen-max-2025-01-25',
    },
    contextWindowTokens: 131_072,
    description:
      'Hundred-billion-scale ultra-large Qwen model supporting Chinese, English, and other languages; the API model behind current Qwen2.5 products.',
    displayName: 'Qwen Max',
    id: 'qwen-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 2.4 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    config: {
      deploymentName: 'qwen-long-latest',
    },
    contextWindowTokens: 10_000_000,
    description:
      'Ultra-large Qwen model with long context and chat across long- and multi-document scenarios.',
    displayName: 'Qwen Long',
    id: 'qwen-long',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    config: {
      deploymentName: 'qwen3-omni-flash-2025-09-15',
    },
    contextWindowTokens: 65_536,
    description:
      'Qwen-Omni accepts combined inputs across text, images, audio, and video, and outputs text or speech. It offers multiple natural voice styles, supports multilingual and dialect speech, and fits use cases like writing, vision recognition, and voice assistants.',
    displayName: 'Qwen3 Omni Flash',
    id: 'qwen3-omni-flash',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-15',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'qwen-omni-turbo-2025-03-26',
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen-Omni models support multimodal inputs (video, audio, images, text) and output audio and text.',
    displayName: 'Qwen Omni Turbo',
    id: 'qwen-omni-turbo',
    maxOutput: 2048,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen-Omni models support multimodal inputs (video, audio, images, text) and output audio and text.',
    displayName: 'Qwen2.5 Omni 7B',
    id: 'qwen2.5-omni-7b',
    maxOutput: 2048,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'qwen-vl-plus-2025-08-15',
    },
    contextWindowTokens: 131_072,
    description:
      'Enhanced large-scale Qwen vision-language model with major gains in detail and text recognition, supporting over one-megapixel resolution and arbitrary aspect ratios.',
    displayName: 'Qwen VL Plus',
    id: 'qwen-vl-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.8 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'qwen-vl-max-2025-08-13',
    },
    contextWindowTokens: 131_072,
    description:
      'Ultra-large Qwen vision-language model. Compared to the enhanced version, it further improves visual reasoning and instruction following for stronger visual perception and cognition.',
    displayName: 'Qwen VL Max',
    id: 'qwen-vl-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1.6 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'qwen-vl-ocr-2025-04-13',
    },
    contextWindowTokens: 34_096,
    description:
      'Qwen OCR is a text extraction model for documents, tables, exam images, and handwriting. It supports Chinese, English, French, Japanese, Korean, German, Russian, Italian, Vietnamese, and Arabic.',
    displayName: 'Qwen VL OCR',
    id: 'qwen-vl-ocr',
    maxOutput: 4096,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen-VL (open-source) provides vision understanding and text generation, supporting agent interaction, visual grounding, spatial perception, long-video understanding, and deep reasoning, with stronger text recognition and multilingual support in complex scenes.',
    displayName: 'Qwen3 VL 30B A3B Thinking',
    id: 'qwen3-vl-30b-a3b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 30B non-thinking (Instruct) targets standard instruction-following, maintaining strong multimodal understanding and generation.',
    displayName: 'Qwen3 VL 30B A3B Instruct',
    id: 'qwen3-vl-30b-a3b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 8B thinking mode for lightweight multimodal reasoning and interaction, retaining long-context understanding.',
    displayName: 'Qwen3 VL 8B Thinking',
    id: 'qwen3-vl-8b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 8B non-thinking mode (Instruct) for standard multimodal generation and recognition.',
    displayName: 'Qwen3 VL 8B Instruct',
    id: 'qwen3-vl-8b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B A22B thinking mode (open-source) targets hard reasoning and long-video understanding with top-tier vision+text reasoning.',
    displayName: 'Qwen3 VL 235B A22B Thinking',
    id: 'qwen3-vl-235b-a22b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B A22B non-thinking (Instruct) is for non-thinking instruction scenarios while retaining strong visual understanding.',
    displayName: 'Qwen3 VL 235B A22B Instruct',
    id: 'qwen3-vl-235b-a22b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 32B thinking mode (open-source) targets hard reasoning and long-video understanding with top-tier vision+text reasoning.',
    displayName: 'Qwen3 VL 32B Thinking',
    id: 'qwen3-vl-32b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 32B non-thinking (Instruct) is for non-thinking instruction scenarios while retaining strong visual understanding.',
    displayName: 'Qwen3 VL 32B Instruct',
    id: 'qwen3-vl-32b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'qwen-math-turbo-latest',
    },
    contextWindowTokens: 4096,
    description: 'Qwen Math is a language model specialized for solving math problems.',
    displayName: 'Qwen Math Turbo',
    id: 'qwen-math-turbo',
    maxOutput: 3072,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'qwen-math-plus-latest',
    },
    contextWindowTokens: 4096,
    description: 'Qwen Math is a language model specialized for solving math problems.',
    displayName: 'Qwen Math Plus',
    id: 'qwen-math-plus',
    maxOutput: 3072,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'qwen-coder-turbo-latest',
    },
    contextWindowTokens: 131_072,
    description: 'Qwen code model.',
    displayName: 'Qwen Coder Turbo',
    id: 'qwen-coder-turbo',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'qwen-coder-plus-latest',
    },
    contextWindowTokens: 131_072,
    description: 'Qwen code model.',
    displayName: 'Qwen Coder Plus',
    id: 'qwen-coder-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'QwQ reasoning model trained on Qwen2.5-32B uses RL to greatly improve reasoning. Core math/code metrics (AIME 24/25, LiveCodeBench) and some general benchmarks (IFEval, LiveBench) reach full DeepSeek-R1 levels and significantly exceed DeepSeek-R1-Distill-Qwen-32B.',
    displayName: 'QwQ 32B',
    id: 'qwq-32b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-06',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description: 'QwQ is an experimental research model from Qwen focused on improved reasoning.',
    displayName: 'QwQ 32B Preview',
    id: 'qwq-32b-preview',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-11-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'qvq-max-2025-05-15',
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen QVQ visual reasoning model supports vision input and chain-of-thought output, with stronger performance in math, coding, visual analysis, creative, and general tasks.',
    displayName: 'QVQ Max',
    id: 'qvq-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-15',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'qvq-plus-2025-05-15',
    },
    contextWindowTokens: 131_072,
    description:
      'Visual reasoning model with vision input and chain-of-thought output. The qvq-plus series follows qvq-max and offers faster reasoning with a better quality-cost balance.',
    displayName: 'QVQ Plus',
    id: 'qvq-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-15',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'QVQ is an experimental research model from Qwen focused on improving visual reasoning, especially for math reasoning.',
    displayName: 'QVQ 72B Preview',
    id: 'qvq-72b-preview',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 36, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Qwen2.5 open-source 7B model.',
    displayName: 'Qwen2.5 7B',
    id: 'qwen2.5-7b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Qwen2.5 open-source 14B model.',
    displayName: 'Qwen2.5 14B',
    id: 'qwen2.5-14b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Qwen2.5 open-source 32B model.',
    displayName: 'Qwen2.5 32B',
    id: 'qwen2.5-32b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Qwen2.5 open-source 72B model.',
    displayName: 'Qwen2.5 72B',
    id: 'qwen2.5-72b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'Qwen2.5 open-source 72B model.',
    displayName: 'Qwen2.5 14B 1M',
    id: 'qwen2.5-14b-instruct-1m',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-27',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Qwen-Math delivers strong math problem-solving.',
    displayName: 'Qwen2.5 Math 7B',
    id: 'qwen2.5-math-7b-instruct',
    maxOutput: 3072,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Qwen-Math delivers strong math problem-solving.',
    displayName: 'Qwen2.5 Math 72B',
    id: 'qwen2.5-math-72b-instruct',
    maxOutput: 3072,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-23',
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Open-source Qwen code model.',
    displayName: 'Qwen2.5 Coder 7B',
    id: 'qwen2.5-coder-7b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Open-source Qwen code model.',
    displayName: 'Qwen2.5 Coder 14B',
    id: 'qwen2.5-coder-14b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Open-source Qwen code model.',
    displayName: 'Qwen2.5 Coder 32B',
    id: 'qwen2.5-coder-32b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Improved instruction following, math, problem solving, and coding, with stronger general object recognition. Supports precise visual element localization across formats, long video understanding (up to 10 minutes) with second-level event timing, temporal ordering and speed understanding, and agents that can control OS or mobile via parsing and localization. Strong key info extraction and JSON output. This is the 72B, strongest version in the series.',
    displayName: 'Qwen2.5 VL 72B',
    id: 'qwen2.5-vl-72b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 48, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-27',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen2.5VL series model that reaches near Qwen2.5VL-72B performance on math and subject QA. Response style is tuned for human preference, especially for objective queries like math, logical reasoning, and knowledge QA, with clearer and more detailed outputs. This is the 32B version.',
    displayName: 'Qwen2.5 VL 32B',
    id: 'qwen2.5-vl-32b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-24',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Improved instruction following, math, problem solving, and coding, with stronger general object recognition. Supports precise visual element localization across formats, long video understanding (up to 10 minutes) with second-level event timing, temporal ordering and speed understanding, and agents that can control OS or mobile via parsing and localization. Strong key info extraction and JSON output. This is the 72B, strongest version in the series.',
    displayName: 'Qwen2.5 VL 7B',
    id: 'qwen2.5-vl-7b-instruct',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-27',
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
      '685B full model released on 2025-05-28. DeepSeek-R1 uses large-scale RL in post-training, greatly improving reasoning with minimal labeled data, and performs strongly on math, coding, and natural language reasoning.',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek-r1-0528',
    maxOutput: 16_384,
    organization: 'DeepSeek',
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
      search: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 is an in-house MoE model with 671B parameters and 37B active, pretrained on 14.8T tokens and strong at long text, code, math, encyclopedic knowledge, and Chinese.',
    displayName: 'DeepSeek V3',
    id: 'deepseek-v3',
    maxOutput: 8192,
    organization: 'DeepSeek',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-27',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Qwen-1.5B is distilled from Qwen2.5-Math-1.5B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Qwen 1.5B',
    id: 'deepseek-r1-distill-qwen-1.5b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
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
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Qwen-7B is distilled from Qwen2.5-Math-7B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Qwen 7B',
    id: 'deepseek-r1-distill-qwen-7b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Qwen-14B is distilled from Qwen2.5-14B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    id: 'deepseek-r1-distill-qwen-14b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Qwen-32B is distilled from Qwen2.5-32B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'deepseek-r1-distill-qwen-32b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Llama-8B is distilled from Llama-3.1-8B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Llama 8B',
    id: 'deepseek-r1-distill-llama-8b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
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
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1-Distill-Llama-70B is distilled from Llama-3.3-70B-Instruct using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Llama 70B',
    id: 'deepseek-r1-distill-llama-70b',
    maxOutput: 16_384,
    organization: 'DeepSeek',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const qwenImageModels: AIImageModelCard[] = [
  {
    description:
      'Qwen Image Edit is an image-to-image model that edits images based on input images and text prompts, enabling precise adjustments and creative transformations.',
    displayName: 'Qwen Image Edit',
    enabled: true,
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
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.3, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-18',
    type: 'image',
  },
  {
    description:
      'Qwen-Image is a general image generation model supporting multiple art styles and strong complex text rendering, especially Chinese and English. It supports multi-line layouts, paragraph-level text, and fine detail for complex text-image layouts.',
    displayName: 'Qwen Image',
    enabled: true,
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
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.25, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-13',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.2 Speed is the latest model with upgrades in creativity, stability, and realism, delivering fast generation and high value.',
    displayName: 'Wanxiang2.2 T2I Flash',
    enabled: true,
    id: 'wan2.2-t2i-flash',
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
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-07-28',
    type: 'image',
  },
  {
    description:
      'Wanxiang 2.2 Pro is the latest model with upgrades in creativity, stability, and realism, producing richer details.',
    displayName: 'Wanxiang2.2 T2I Plus',
    enabled: true,
    id: 'wan2.2-t2i-plus',
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
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
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
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      'FLUX.1 [schnell] is the most advanced open-source few-step model, surpassing similar competitors and even strong non-distilled models like Midjourney v6.0 and DALL-E 3 (HD). It is finely tuned to preserve pretraining diversity, significantly improving visual quality, instruction following, size/aspect variation, font handling, and output diversity.',
    displayName: 'FLUX.1 [schnell]',
    enabled: true,
    id: 'flux-schnell',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['512x1024', '768x512', '768x1024', '1024x576', '576x1024', '1024x1024'],
      },
      steps: { default: 4, max: 12, min: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-07',
    type: 'image',
  },
  {
    description:
      'FLUX.1 [dev] is an open-weights distilled model for non-commercial use. It keeps near-pro image quality and instruction following while running more efficiently, using resources better than same-size standard models.',
    displayName: 'FLUX.1 [dev]',
    enabled: true,
    id: 'flux-dev',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['512x1024', '768x512', '768x1024', '1024x576', '576x1024', '1024x1024'],
      },
      steps: { default: 50, max: 50, min: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-07',
    type: 'image',
  },
  {
    description:
      'FLUX.1-merged combines the deep features explored in "DEV" with the high-speed advantages of "Schnell", extending performance limits and broadening applications.',
    displayName: 'FLUX.1-merged',
    enabled: true,
    id: 'flux-merged',
    organization: 'Qwen',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['512x1024', '768x512', '768x1024', '1024x576', '576x1024', '1024x1024'],
      },
      steps: { default: 30, max: 30, min: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-08-22',
    type: 'image',
  },
  {
    description:
      'stable-diffusion-3.5-large is an 800M-parameter MMDiT text-to-image model with excellent quality and prompt alignment, supporting 1-megapixel images and efficient runs on consumer hardware.',
    displayName: 'StableDiffusion 3.5 Large',
    id: 'stable-diffusion-3.5-large',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1024, min: 512, step: 128 },
      prompt: {
        default: '',
      },
      steps: { default: 40, max: 500, min: 1 },
      width: { default: 1024, max: 1024, min: 512, step: 128 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-10-25',
    type: 'image',
  },
  {
    description:
      'stable-diffusion-3.5-large-turbo applies adversarial diffusion distillation (ADD) to stable-diffusion-3.5-large for faster speed.',
    displayName: 'StableDiffusion 3.5 Large Turbo',
    id: 'stable-diffusion-3.5-large-turbo',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1024, min: 512, step: 128 },
      prompt: {
        default: '',
      },
      steps: { default: 40, max: 500, min: 1 },
      width: { default: 1024, max: 1024, min: 512, step: 128 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-10-25',
    type: 'image',
  },
  {
    description:
      'stable-diffusion-xl brings major improvements over v1.5 and matches top open text-to-image results. Improvements include a 3x larger UNet backbone, a refinement module for better image quality, and more efficient training techniques.',
    displayName: 'StableDiffusion xl',
    id: 'stable-diffusion-xl',
    organization: 'Qwen',
    parameters: {
      height: { default: 1024, max: 1024, min: 512, step: 128 },
      prompt: {
        default: '',
      },
      steps: { default: 50, max: 500, min: 1 },
      width: { default: 1024, max: 1024, min: 512, step: 128 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-04-09',
    type: 'image',
  },
  {
    description:
      'stable-diffusion-v1.5 is initialized from the v1.2 checkpoint and fine-tuned for 595k steps on "laion-aesthetics v2 5+" at 512x512 resolution, reducing text conditioning by 10% to improve classifier-free guidance sampling.',
    displayName: 'StableDiffusion v1.5',
    id: 'stable-diffusion-v1.5',
    organization: 'Qwen',
    parameters: {
      height: { default: 512, max: 1024, min: 512, step: 128 },
      prompt: {
        default: '',
      },
      steps: { default: 50, max: 500, min: 1 },
      width: { default: 512, max: 1024, min: 512, step: 128 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2024-04-09',
    type: 'image',
  },
];

export const allModels = [...qwenChatModels, ...qwenImageModels];

export default allModels;
