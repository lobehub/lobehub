import { type AIChatModelCard } from '../../types/aiModel';
import { qwenImageModels } from './image';
import { qwenVideoModels } from './video';

// https://help.aliyun.com/zh/model-studio/models?spm=a2c4g.11186623

const qwenChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro 0813 is the August 13 snapshot of the V4 Pro flagship. It targets high-intensity reasoning, coding, math, and agentic workflows with a 1M context window. Peak pricing is 9/27 CNY per million tokens; off-peak (22:00–08:00) is 4.5/13.5.',
    displayName: 'DeepSeek V4 Pro 0813',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro-0813',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 9 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-13',
    settings: {
      reasoningEffort: {
        controlsThinking: true,
        levels: ['none', 'low', 'high', 'max'],
      },
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
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash 0731 is the July 31 snapshot of the V4 Flash model. It is the fast, cost-efficient member of the V4 family with a 1M context window and hybrid thinking.',
    displayName: 'DeepSeek V4 Flash 0731',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash-0731',
    maxOutput: 393_216,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-31',
    settings: {
      reasoningEffort: {
        controlsThinking: true,
        levels: ['none', 'low', 'high', 'max'],
      },
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'The September update to Qwen3.8 Max improves coding, multi-tool orchestration, and visual understanding.',
    displayName: 'Qwen3.8 Max 0902',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen3.8-max-0902',
    isOfficial: true,
    maxOutput: 131_072,
    /** @see https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max */
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-09-02',
    settings: {
      extendParams: ['preserveThinking'],
      reasoningEffort: {
        controlsThinking: true,
        levels: ['none', 'low', 'medium', 'xhigh'],
      },
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.8 Max supports complex coding, multimodal understanding, and long-horizon agentic workflows with a 1M context window.',
    displayName: 'Qwen3.8 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen3.8-max',
    isOfficial: true,
    maxOutput: 131_072,
    /** @see https://www.alibabacloud.com/help/en/model-studio/qwen3-8-max */
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-02',
    settings: {
      extendParams: ['preserveThinking'],
      reasoningEffort: {
        controlsThinking: true,
        levels: ['none', 'low', 'medium', 'xhigh'],
      },
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi-K2.6 is a large language model launched by Moonshot AI, with excellent coding and tool calling capabilities. Service deployment is only supported in mainland China.',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 98_304,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 6.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 6.5 * 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
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
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'kimi-k2.5',
    maxOutput: 32_768,
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
    contextWindowTokens: 196_608,
    description:
      'MiniMax-M2.5 is a flagship open-source large model from MiniMax, focusing on solving complex real-world tasks. Its core strengths are multi-language programming capabilities and the ability to solve complex tasks as an Agent.',
    displayName: 'MiniMax-M2.5',
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'MiniMax-M2.5',
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
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.1 is a flagship open-source large model from MiniMax, focusing on solving complex real-world tasks. Its core strengths are multi-language programming capabilities and the ability to solve complex tasks as an Agent.',
    displayName: 'MiniMax-M2.1',
    family: 'minimax',
    generation: 'minimax-m2.1',
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3-vl-plus', // Supports context caching
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen VL is a text generation model with vision understanding. It can do OCR and also summarize and reason, such as extracting attributes from product photos or solving problems from images.',
    displayName: 'Qwen3 VL Plus',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-plus',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.2,
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
              '[0, 0.032]': 1.6,
              '[0.032, 0.128]': 2.4,
              '[0.128, infinity]': 4.8,
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3-vl-flash-2026-01-22',
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 VL Flash: lightweight, high-speed reasoning version for latency-sensitive or high-volume requests.',
    displayName: 'Qwen3 VL Flash',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-flash',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.05,
              '[0.032, 0.128]': 0.075,
              '[0.128, 1]': 0.12,
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
              '[0, 0.032]': 0.4,
              '[0.032, 0.128]': 0.6,
              '[0.128, 1]': 0.96,
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
      search: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash is the fast, cost-efficient member of the V4 family with a 1M context window and hybrid thinking — one of the cheapest capable models available.',
    displayName: 'DeepSeek V4 Flash',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      reasoningEffort: { controlsThinking: true, levels: ['none', 'high', 'max'] },
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
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, built for high-intensity reasoning and agentic workflows with a 1M context window — excellent Chinese writing and outstanding value for money.',
    displayName: 'DeepSeek V4 Pro',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      reasoningEffort: { controlsThinking: true, levels: ['none', 'high', 'max'] },
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
      'deepseek-v3.2 introduces sparse attention mechanism, aiming to improve training and inference efficiency when processing long texts, priced lower than deepseek-v3.1.',
    displayName: 'DeepSeek V3.2',
    family: 'deepseek',
    generation: 'deepseek-v3.2',
    id: 'deepseek-v3.2',
    maxOutput: 65_536,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.57, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.71, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'deepseek-v3.2-exp introduces sparse attention to improve training and inference efficiency on long text, at a lower price than deepseek-v3.1.',
    displayName: 'DeepSeek V3.2 Exp',
    family: 'deepseek',
    generation: 'deepseek-v3.2',
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
      'DeepSeek V3.1 uses a hybrid reasoning architecture with both thinking and non-thinking modes.',
    displayName: 'DeepSeek V3.1',
    family: 'deepseek',
    generation: 'deepseek-v3.1',
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
      searchImpl: 'params',
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
    family: 'kimi',
    generation: 'kimi-k2',
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
    family: 'kimi',
    generation: 'kimi-k2',
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
    contextWindowTokens: 1_000_000,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes. GLM-5.2 is Zhipu’s flagship model for the era of long-horizon tasks, supporting 1M tokens context and optimized for long-horizon planning, complex coding, and agent execution.',
    displayName: 'GLM-5.2',
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-17',
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
    contextWindowTokens: 202_745,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes. GLM-5.1 is the latest flagship variant for long-horizon agentic engineering and complex development workflows.',
    displayName: 'GLM-5.1',
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-14',
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
    contextWindowTokens: 202_752,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-5',
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 4,
              '[0.032, infinity]': 6,
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
              '[0, 0.032]': 18,
              '[0.032, infinity]': 22,
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
    contextWindowTokens: 202_752,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.7',
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7',
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
    contextWindowTokens: 202_752,
    description:
      'The GLM series is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.6',
    family: 'glm',
    generation: 'glm-4.6',
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
    family: 'glm',
    generation: 'glm-4.5',
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
    family: 'glm',
    generation: 'glm-4.5',
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
      deploymentName: 'qwen3-coder-next',
    },
    contextWindowTokens: 262_144,
    description:
      'Next‑gen Qwen coder optimized for complex multi-file code generation, debugging, and high‑throughput agent workflows. Designed for strong tool integration and improved reasoning performance.',
    displayName: 'Qwen3 Coder Next',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-next',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.3,
              '[0.032, 0.128]': 0.5,
              '[0.128, infinity]': 0.8,
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
              '[0.032, 0.128]': 2.5,
              '[0.128, infinity]': 4,
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
      deploymentName: 'qwen3-coder-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen code model. The latest Qwen3-Coder series is based on Qwen3 and delivers strong coding-agent abilities, tool use, and environment interaction for autonomous programming, with excellent code performance and solid general capability.',
    displayName: 'Qwen3 Coder Plus',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.2,
              '[0.032, 0.128]': 0.36,
              '[0.128, 0.256]': 0.6,
              '[0.256, infinity]': 1.2,
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
              '[0.032, 0.128]': 1.8,
              '[0.128, 0.256]': 3,
              '[0.256, infinity]': 6,
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
              '[0, 0.032]': 5,
              '[0.032, 0.128]': 9,
              '[0.128, 0.256]': 15,
              '[0.256, infinity]': 60,
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.06,
              '[0.032, 0.128]': 0.1,
              '[0.128, 0.256]': 0.16,
              '[0.256, 1]': 0.32,
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
              '[0, 0.032]': 0.3,
              '[0.032, 0.128]': 0.5,
              '[0.128, 0.256]': 0.8,
              '[0.256, 1]': 1.6,
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
              '[0.032, 0.128]': 2.5,
              '[0.128, 0.256]': 4,
              '[0.256, 1]': 9.6,
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-480b-a35b-instruct',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.5,
              '[0.032, 0.128]': 2.7,
              '[0.128, 0.2]': 4.5,
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
              '[0, 0.032]': 7.5,
              '[0.032, 0.128]': 13.5,
              '[0.128, 0.2]': 22.5,
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-30b-a3b-instruct',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.45,
              '[0.032, 0.128]': 0.75,
              '[0.128, 0.2]': 1.2,
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
              '[0, 0.032]': 2.25,
              '[0.032, 0.128]': 3.75,
              '[0.128, 0.2]': 6,
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.6 27B is an open-source dense model with strong performance in reasoning, coding, and general capabilities. It supports thinking mode by default, offering balanced performance and efficiency.',
    displayName: 'Qwen3.6-27B',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-27b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The Qwen3.6 35B-A3B native vision-language model is built on a hybrid architecture that integrates a linear attention mechanism with a sparse Mixture-of-Experts (MoE) design, achieving higher inference efficiency. Compared to the 3.5-35B-A3B model, it delivers significant improvements in agentic coding capabilities, mathematical reasoning, code reasoning, spatial intelligence, as well as object localization and target detection.',
    displayName: 'Qwen3.6-35B-A3B',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-35b-a3b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.375, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-16',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Supports text, image, and video inputs. For text-only tasks, its performance is comparable to Qwen3 Max, offering higher efficiency and lower cost. In multimodal capabilities, it delivers significant improvements over the Qwen3 VL series.',
    displayName: 'Qwen3.5-397B-A17B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-397b-a17b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-16',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Supports text, image, and video inputs. For text-only tasks, its performance is comparable to Qwen3 Max, offering higher efficiency and lower cost. In multimodal capabilities, it delivers significant improvements over the Qwen3 VL series.',
    displayName: 'Qwen3.5-122B-A10B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-122b-a10b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Supports text, image, and video inputs. For text-only tasks, its performance is comparable to Qwen3 Max, offering higher efficiency and lower cost. In multimodal capabilities, it delivers significant improvements over the Qwen3 VL series.',
    displayName: 'Qwen3.5-27B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-27b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Supports text, image, and video inputs. For text-only tasks, its performance is comparable to Qwen3 Max, offering higher efficiency and lower cost. In multimodal capabilities, it delivers significant improvements over the Qwen3 VL series.',
    displayName: 'Qwen3.5-35B-A3B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-35b-a3b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-24',
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
      'Qwen3 thinking-mode open-source model. Compared to the previous version (Qwen3-235B-A22B), it significantly improves logic, general ability, knowledge, and creativity, suitable for hard reasoning scenarios.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-235b-a22b-thinking-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.23, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.3, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-235b-a22b-instruct-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.23, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.92, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-30b-a3b-thinking-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-30b-a3b-instruct-2507',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-next-80b-a3b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-next-80b-a3b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-235b-a22b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-32b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-30b-a3b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-14b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.2, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-8b',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
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
    family: 'qwen',
    generation: 'qwen3',
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
    family: 'qwen',
    generation: 'qwen3',
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
    family: 'qwen',
    generation: 'qwq',
    id: 'qwq-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.8-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.8 native vision-language Flash model, built on next-generation hybrid architecture with 125B parameters (6B active per token). Features a 1M context window, fast inference, and strong reasoning and multimodal capabilities across coding, agent workflows, and visual understanding.',
    displayName: 'Qwen3.8 Flash',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.8',
    id: 'qwen3.8-flash',
    maxOutput: 131_072,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.47, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.016, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-08-26',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.7-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 native vision-language Flash model, with comprehensive improvements in multimodal understanding and Agent execution capabilities compared to Qwen3.6-Flash. Key enhancements include strengthened multimodal foundational capabilities, stronger universal object recognition, further improved real-world perception and spatial intelligence, significantly upgraded capabilities in multimodal Agent scenarios such as Search Agent and CI Agent, more stable end-to-end task execution, optimized multimodal Coding capabilities, and a smoother vibe coding experience.',
    displayName: 'Qwen3.7 Flash',
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.03, upTo: 32_000 },
            { rate: 0.1, upTo: 256_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.13, upTo: 32_000 },
            { rate: 0.4, upTo: 256_000 },
            { rate: 0.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.006, upTo: 32_000 },
            { rate: 0.02, upTo: 256_000 },
            { rate: 0.04, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-07-21',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.6-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 native vision-language Flash model delivers significantly improved performance compared to the 3.5-Flash version. This model focuses on enhancing agentic coding capabilities (substantially outperforming its predecessor across multiple code-agent benchmarks), as well as improving mathematical reasoning and code reasoning abilities. On the vision side, it shows notable gains in spatial intelligence, with particularly strong improvements in object localization and target detection.',
    displayName: 'Qwen3.6 Flash',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.25, upTo: 256_000 },
            { rate: 1, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.5, upTo: 256_000 },
            { rate: 4, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.05, upTo: 256_000 },
            { rate: 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-16',
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.5-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'The Qwen3.5 native vision-language Flash model is built on a hybrid architecture that combines a linear attention mechanism with a sparse Mixture-of-Experts (MoE) design, achieving higher inference efficiency. Compared to the 3 series, it delivers substantial improvements in both pure text and multimodal performance. It also offers fast response times, balancing inference speed and overall capability.',
    displayName: 'Qwen3.5 Flash',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-24',
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
      deploymentName: 'qwen-flash', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description: 'Fastest and lowest-cost Qwen model, ideal for simple tasks.',
    displayName: 'Qwen Flash',
    family: 'qwen',
    id: 'qwen-flash',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.05, upTo: 256_000 },
            { rate: 0.25, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.4, upTo: 256_000 },
            { rate: 2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.01, upTo: 256_000 },
            { rate: 0.05, upTo: 'infinity' },
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
    family: 'qwen',
    id: 'qwen-turbo',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.7-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Plus is a multimodal interactive hybrid agent model, building upon the Qwen3.7 series text capabilities to unify vision and language. It excels at GUI operation, visual coding, and complex agentic workflows.',
    displayName: 'Qwen3.7 Plus',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-plus',
    isOfficial: true,
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.08, upTo: 256_000 },
            { rate: 0.24, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.4, upTo: 256_000 },
            { rate: 1.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 1.6, upTo: 256_000 },
            { rate: 4.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-06-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.6-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.6 Plus supports text, image, and video input. It delivers a balanced performance across quality, speed, and cost. Its multimodal capabilities are significantly improved compared to the Qwen3 VL series.',
    displayName: 'Qwen3.6 Plus',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.5,
              '[0.256, 1]': 2,
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
              '[0, 0.256]': 3,
              '[0.256, 1]': 6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.1,
              '[0.256, 1]': 0.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-02',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.5-plus-2026-04-20', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen 3.5 is a native vision-language Plus model. Compared to the February 15 snapshot, this version delivers substantial improvements in agentic coding capabilities and significantly faster inference speed. Its knowledge, reasoning, and long-context abilities remain at a high level, meeting the demands of complex agent tasks. It is well-suited for coding agents, production workflows, and high-throughput scenarios. This version corresponds to the April 20, 2026 snapshot.',
    displayName: 'Qwen3.5 Plus 2026-04-20',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-plus-2026-04-20',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.04,
              '[0.256, infinity]': 0.05,
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
              '[0, 0.256]': 0.5,
              '[0.256, infinity]': 0.625,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.4,
              '[0.256, infinity]': 0.5,
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
              '[0, 0.256]': 2.4,
              '[0.256, infinity]': 3,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-22',
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.5-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.5 Plus supports text, image, and video input. Its performance on pure text tasks is comparable to Qwen3 Max, with better performance and lower cost. Its multimodal capabilities are significantly improved compared to the Qwen3 VL series.',
    displayName: 'Qwen3.5 Plus',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.04,
              '[0.256, infinity]': 0.05,
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
              '[0, 0.256]': 0.5,
              '[0.256, infinity]': 0.625,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.4,
              '[0.256, infinity]': 0.5,
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
              '[0, 0.256]': 2.4,
              '[0.256, infinity]': 3,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-15',
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
      deploymentName: 'qwen-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Enhanced ultra-large Qwen model supporting Chinese, English, and other languages.',
    displayName: 'Qwen Plus',
    family: 'qwen',
    id: 'qwen-plus',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 0.08,
              '[0.256, infinity]': 0.24,
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
              '[0, 0.256]': 0.4,
              '[0.256, infinity]': 1.2,
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
              '[0, 0.256]_[false]': 1.2,
              '[0, 0.256]_[true]': 4,
              '[0.256, infinity]_[false]': 3.6,
              '[0.256, infinity]_[true]': 12,
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
      reasoning: true,
      search: true,
    },
    config: {
      deploymentName: 'qwen3.7-max', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.7 Max is the flagship omnipotent model of the AI agent era, offering comprehensive capabilities across text, image, and video understanding. It provides superior reasoning, function calling, and agent task execution performance.',
    displayName: 'Qwen3.7 Max',
    enabled: true,
    family: 'qwen',
    generation: 'qwen3.7',
    id: 'qwen3.7-max',
    isOfficial: true,
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-20',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
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
      deploymentName: 'qwen3.6-max-preview',
    },
    contextWindowTokens: 262_144,
    description:
      'The largest closed-source model in the Qwen3.6 series. It delivers stronger world knowledge, instruction following, and agentic coding performance for complex tasks. It is text-only, supports thinking mode by default, explicit caching, and function calling.',
    displayName: 'Qwen3.6 Max Preview',
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-max-preview',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.26,
              '[0.128, infinity]': 0.4,
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
              '[0, 0.128]': 1.3,
              '[0.128, infinity]': 2,
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
              '[0, 0.128]': 7.8,
              '[0.128, infinity]': 12,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-18',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'preserveThinking'],
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
      deploymentName: 'qwen3-max', // Supports context caching
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max models deliver large gains over the 2.5 series in general ability, Chinese/English understanding, complex instruction following, subjective open tasks, multilingual ability, and tool use, with fewer hallucinations. The latest qwen3-max improves agentic programming and tool use over qwen3-max-preview. This release reaches field SOTA and targets more complex agent needs.',
    displayName: 'Qwen3 Max',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-max',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.24,
              '[0.032, 0.128]': 0.48,
              '[0.128, infinity]': 0.6,
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
              '[0, 0.032]': 1.2,
              '[0.032, 0.128]': 2.4,
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
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 12,
              '[0.128, infinity]': 15,
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-max-preview',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.24,
              '[0.032, 0.128]': 0.48,
              '[0.128, infinity]': 0.6,
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
              '[0, 0.032]': 1.2,
              '[0.032, 0.128]': 2.4,
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
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 12,
              '[0.128, infinity]': 15,
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
    family: 'qwen',
    id: 'qwen-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
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
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.5-omni-plus',
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5 Omni Plus supports text, image, and video input. It is the latest full-modal Qwen model for high-quality multimodal understanding and generation.',
    displayName: 'Qwen3.5 Omni Plus',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-omni-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 11, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 44, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-30',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.5-omni-flash',
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5 Omni Flash is a fast, cost-effective full-modal Qwen model that supports text, image, and video input.',
    displayName: 'Qwen3.5 Omni Flash',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-omni-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 11.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-30',
    settings: {
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
    },
    config: {
      deploymentName: 'qwen3-omni-flash-2025-12-01',
    },
    contextWindowTokens: 65_536,
    description:
      'Qwen3-Omni-Flash is a multimodal large model built on a Thinker–Talker Mixture-of-Experts (MoE) architecture. It supports efficient understanding across text, images, audio, and video, along with speech generation capabilities. The model enables text-based interaction in 119 languages and voice interaction in 20 languages, producing human-like speech for precise cross-lingual communication. It features strong instruction-following capabilities and supports customizable system prompts, allowing flexible adaptation to different conversational styles and role settings. It is widely applicable in scenarios such as text creation, voice assistants, and multimedia analysis, delivering a natural and seamless multimodal interaction experience.',
    displayName: 'Qwen3 Omni Flash',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-omni-flash',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.43, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 3.81, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 0.78, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.66, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioOutput', rate: 15.11, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-04',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen-omni-turbo-2025-03-26',
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen-Omni models support multimodal inputs (video, audio, images, text) and output audio and text.',
    displayName: 'Qwen Omni Turbo',
    family: 'qwen',
    id: 'qwen-omni-turbo',
    maxOutput: 2048,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.63, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      video: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen-Omni models support multimodal inputs (video, audio, images, text) and output audio and text.',
    displayName: 'Qwen2.5 Omni 7B',
    family: 'qwen',
    generation: 'qwen2.5',
    id: 'qwen2.5-omni-7b',
    maxOutput: 2048,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.84, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen-vl-plus-2025-08-15',
    },
    contextWindowTokens: 131_072,
    description:
      'Enhanced large-scale Qwen vision-language model with major gains in detail and text recognition, supporting over one-megapixel resolution and arbitrary aspect ratios.',
    displayName: 'Qwen VL Plus',
    family: 'qwen',
    id: 'qwen-vl-plus',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.042, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.63, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen-vl-max-2025-08-13',
    },
    contextWindowTokens: 131_072,
    description:
      'Ultra-large Qwen vision-language model. Compared to the enhanced version, it further improves visual reasoning and instruction following for stronger visual perception and cognition.',
    displayName: 'Qwen VL Max',
    family: 'qwen',
    id: 'qwen-vl-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    id: 'qwen-vl-ocr',
    maxOutput: 4096,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-30b-a3b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-30b-a3b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-8b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-8b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-235b-a22b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-235b-a22b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-32b-thinking',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-vl-32b-instruct',
    maxOutput: 32_768,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.64, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
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
    family: 'qwen',
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
    family: 'qwen',
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
    family: 'qwen',
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
    family: 'qwen',
    generation: 'qwq',
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
    family: 'qwen',
    generation: 'qwq',
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
    family: 'qwen',
    generation: 'qvq',
    id: 'qvq-max',
    maxOutput: 8192,
    organization: 'Qwen',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.8, strategy: 'fixed', unit: 'millionTokens' },
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
    family: 'qwen',
    generation: 'qvq',
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
    family: 'qwen',
    generation: 'qvq',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'qwen',
    generation: 'qwen2.5',
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
    family: 'deepseek',
    generation: 'deepseek-r1',
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
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 is an in-house MoE model with 671B parameters and 37B active, pretrained on 14.8T tokens and strong at long text, code, math, encyclopedic knowledge, and Chinese.',
    displayName: 'DeepSeek V3',
    family: 'deepseek',
    generation: 'deepseek-v3',
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
    description:
      'DeepSeek-R1-Distill-Qwen-1.5B is distilled from Qwen2.5-Math-1.5B using DeepSeek R1 outputs.',
    displayName: 'DeepSeek R1 Distill Qwen 1.5B',
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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
    family: 'deepseek',
    generation: 'deepseek-r1-distill',
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

export const allModels = [...qwenChatModels, ...qwenImageModels, ...qwenVideoModels];

export default allModels;
