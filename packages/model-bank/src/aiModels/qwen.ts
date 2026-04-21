import {
  type AIChatModelCard,
  type AIImageModelCard,
  type AIVideoModelCard,
} from '../types/aiModel';

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
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'deepseek-v3.2 introduces sparse attention mechanism, aiming to improve training and inference efficiency when processing long texts, priced lower than deepseek-v3.1.',
    displayName: 'DeepSeek V3.2',
    id: 'deepseek-v3.2',
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
      functionCall: true,
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
      functionCall: true,
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
    displayName: 'GLM-5',
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
      deploymentName: 'qwen3-coder-next',
    },
    contextWindowTokens: 262_144,
    description:
      'Next‑gen Qwen coder optimized for complex multi-file code generation, debugging, and high‑throughput agent workflows. Designed for strong tool integration and improved reasoning performance.',
    displayName: 'Qwen3 Coder Next',
    id: 'qwen3-coder-next',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1,
              '[0.032, 0.128]': 1.5,
              '[0.128, infinity]': 2.5,
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
              '[0.128, infinity]': 10,
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The Qwen3.6 35B-A3B native vision-language model is built on a hybrid architecture that integrates a linear attention mechanism with a sparse Mixture-of-Experts (MoE) design, achieving higher inference efficiency. Compared to the 3.5-35B-A3B model, it delivers significant improvements in agentic coding capabilities, mathematical reasoning, code reasoning, spatial intelligence, as well as object localization and target detection.',
    displayName: 'Qwen3.6-35B-A3B',
    id: 'qwen3.6-35b-a3b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.8, strategy: 'fixed', unit: 'millionTokens' },
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
    id: 'qwen3.5-397b-a17b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 1.5,
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
              '[0, 0.128]': 7.2,
              '[0.128, infinity]': 18,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    id: 'qwen3.5-122b-a10b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.8,
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
              '[0, 0.128]': 6.4,
              '[0.128, infinity]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    id: 'qwen3.5-27b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.6,
              '[0.128, infinity]': 1.8,
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
              '[0, 0.128]': 4.8,
              '[0.128, infinity]': 14.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    id: 'qwen3.5-35b-a3b',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.4,
              '[0.128, infinity]': 1.6,
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
              '[0, 0.128]': 3.2,
              '[0.128, infinity]': 12.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    enabled: true,
    id: 'qwen3.6-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 1.2 * 0.1,
              '[0.256, infinity]': 4.8 * 0.1,
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
              '[0, 0.256]': 1.2 * 1.25,
              '[0.256, infinity]': 4.8 * 1.25,
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
              '[0, 0.256]': 1.2,
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
              '[0, 0.256]': 7.2,
              '[0.256, infinity]': 28.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
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
    id: 'qwen3.5-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2, upTo: 0.128 },
            { rate: 0.8, upTo: 0.256 },
            { rate: 1.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 2, upTo: 0.128 },
            { rate: 8, upTo: 0.256 },
            { rate: 12, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 0.2 * 0.2, upTo: 0.128 },
            { rate: 0.8 * 0.2, upTo: 0.256 },
            { rate: 1.2 * 0.2, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
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
      video: true,
      vision: true,
    },
    config: {
      deploymentName: 'qwen3.6-plus', // Supports context caching
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen 3.6-Plus introduces major upgrades in coding capabilities, with a focus on Agentic Coding and front-end development, significantly enhancing the Vibe Coding experience. Its reasoning ability across general scenarios has been further improved. In terms of multimodality, capabilities such as universal recognition, OCR, and object localization have been substantially enhanced. It also fixes known issues from the Qwen 3.5-Plus release. Usage remains the same as Qwen 3.5-Plus.',
    displayName: 'Qwen3.6 Plus',
    enabled: true,
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.256]': 2 * 0.1,
              '[0.256, infinity]': 8 * 0.1,
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
              '[0, 0.256]': 2 * 1.25,
              '[0.256, infinity]': 8 * 1.25,
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
              '[0, 0.256]': 2,
              '[0.256, infinity]': 8,
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
              '[0, 0.256]': 12,
              '[0.256, infinity]': 48,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-04-02',
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
    id: 'qwen3.5-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.8 * 0.1,
              '[0.128, 0.256]': 2 * 0.1,
              '[0.256, infinity]': 4 * 0.1,
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
              '[0, 0.128]': 0.8 * 1.25,
              '[0.128, 0.256]': 2 * 1.25,
              '[0.256, infinity]': 4 * 1.25,
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
              '[0, 0.128]': 0.8,
              '[0.128, 0.256]': 2,
              '[0.256, infinity]': 4,
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
              '[0, 0.128]': 4.8,
              '[0.128, 0.256]': 12,
              '[0.256, infinity]': 24,
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
      reasoning: true,
      search: true,
    },
    config: {
      deploymentName: 'qwen3.6-max-preview', // Supports context caching
    },
    contextWindowTokens: 262_144,
    description:
      'The largest closed-source model in the Qwen3.6 series. It delivers stronger world knowledge, instruction following, and agentic coding performance for complex tasks. It is text-only, supports thinking mode by default, explicit caching, and function calling.',
    displayName: 'Qwen3.6 Max Preview',
    id: 'qwen3.6-max-preview',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 9 * 0.2,
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
              '[0, 0.128]': 9,
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
              '[0, 0.128]': 54,
              '[0.128, infinity]': 90,
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
              '[0, 0.032]': 2.5 * 0.2,
              '[0.032, 0.128]': 4 * 0.2,
              '[0.128, infinity]': 7 * 0.2,
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
    id: 'qwen3.5-omni-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.8,
              '[0.128, 0.256]': 2,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'audioInput', rate: 4.96, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.8,
              '[0.128, infinity]': 2,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'imageInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.128]': 9.6,
              '[0.128, 0.256]': 24,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    id: 'qwen3.5-omni-flash',
    maxOutput: 65_536,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.2,
              '[0.128, 0.256]': 0.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'audioInput', rate: 1.24, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: {
            prices: {
              '[0, 0.128]': 0.2,
              '[0.128, infinity]': 0.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'imageInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.128]': 4,
              '[0.128, 0.256]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
    id: 'qwen3-omni-flash',
    maxOutput: 16_384,
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'audioInput', rate: 15.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'imageInput', rate: 3.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6.9, strategy: 'fixed', unit: 'millionTokens' },
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
      video: true,
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.1, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-12-19',
    type: 'image',
  },
  {
    description:
      'The Qwen-Image-2.0 series full-version model integrates image generation and image editing into a unified capability. It supports more professional text rendering with up to 1k token instruction capacity, delivers more delicate and realistic visual textures, enables fine-grained depiction of realistic scenes, and demonstrates stronger semantic alignment with prompts. The full-version model provides the strongest text rendering capability and the highest level of realism within the 2.0 series.',
    displayName: 'Qwen Image 2.0 Pro',
    id: 'qwen-image-2.0-pro',
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.5, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.5, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.3, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.5, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.25, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.5, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.2, strategy: 'fixed', unit: 'image' }],
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
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
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
      promptExtend: { default: false },
      watermark: { default: false },
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
      promptExtend: { default: false },
      watermark: { default: false },
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

const qwenVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Wanxiang 2.7 Image-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Combined with more dynamic and rhythmically driven shot transitions, it achieves stronger overall performance and storytelling.',
    displayName: 'Wan2.7 I2V',
    enabled: true,
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-03',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.7 Text-to-Video delivers a comprehensive upgrade in performance capabilities. Dramatic scenes feature delicate and natural emotional expression, while action sequences are intense and impactful. Enhanced with more dynamic and rhythmically driven shot transitions, it achieves stronger overall acting and storytelling performance.',
    displayName: 'Wan2.7 T2V',
    enabled: true,
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-03',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 introduces multi-shot narrative capabilities, while also supporting automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.6 I2V Flash',
    enabled: true,
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 Reference-to-Video – Flash offers faster generation and better cost performance. It supports referencing specific characters or any objects, accurately maintaining consistency in appearance and voice, and enables multi-character reference for co-performance.',
    displayName: 'Wan2.6 R2V Flash',
    enabled: true,
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.5, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-12-16',
    type: 'video',
  },
  {
    description:
      'Wanxiang 2.6 introduces multi-shot narrative capabilities, while also supporting automatic voiceover generation and the ability to incorporate custom audio files.',
    displayName: 'Wan2.6 T2V',
    enabled: true,
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 1, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.2, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.2, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.7, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.7, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.7, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
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
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.7, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2025-01-08',
    type: 'video',
  },
  {
    description:
      'Intelligent storyboarding understands scene transitions within scripts, automatically arranging camera positions and shot types. A native multimodal framework ensures audiovisual consistency. Removes duration constraints, enabling more flexible multi-shot storytelling.',
    displayName: 'Kling V3 Video Generation',
    enabled: true,
    id: 'kling/kling-v3-video-generation',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      duration: { default: 5, max: 12, min: 3 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['720p', '1080p'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.9, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'New “All-in-One Reference” feature supports 3–8 second videos or multiple images to anchor character elements. Can match original audio and lip movements for authentic character representation. Enhances video consistency and dynamic expression. Supports audiovisual synchronization and intelligent storyboarding.',
    displayName: 'Kling V3 Omni Video Generation',
    enabled: true,
    id: 'kling/kling-v3-omni-video-generation',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '9:16', '1:1'],
      },
      duration: { default: 5, max: 12, min: 3 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      resolution: {
        default: '1080p',
        enum: ['720p', '1080p'],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.9, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Enter a text prompt to generate video. ViduQ3-Pro text-to-video is a flagship-level audio-visual native model. Supports up to 16 seconds of synchronized audio-visual generation, allowing free multi-shot switching while precisely controlling pacing, emotion, and narrative continuity. With a leading parameter scale, it delivers exceptional image quality, character consistency, and emotional expression, meeting cinematic standards. Ideal for professional production scenarios such as advertising (e-commerce, TVC, performance campaigns), animated series, live-action drama, and games.',
    displayName: 'Vidu Q3 Pro Text-to-Video',
    enabled: true,
    id: 'vidu/viduq3-pro_text2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      generateAudio: { default: true },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '960x528',
          '528x960',
          '720x720',
          '816x608',
          '608x816',
          '1280x720',
          '720x1280',
          '960x960',
          '1104x816',
          '816x1104',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1674x1238',
          '1238x1674',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.78125, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Enter a text prompt to generate video. ViduQ3-Turbo text-to-video is a high-performance accelerated model. It offers extremely fast generation while maintaining high-quality visuals and dynamic expression, excelling in action scenes, emotional rendering, and semantic understanding. Cost-effective and well-suited for casual entertainment scenarios such as social media images, AI companions, and special effects assets.',
    displayName: 'Vidu Q3 Turbo Text-to-Video',
    id: 'vidu/viduq3-turbo_text2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      generateAudio: { default: true },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '960x528',
          '528x960',
          '720x720',
          '816x608',
          '608x816',
          '1280x720',
          '720x1280',
          '960x960',
          '1104x816',
          '816x1104',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1674x1238',
          '1238x1674',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.375, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Enter a text prompt to generate video. ViduQ2 text-to-video is a model designed for precise instruction adherence and nuanced emotion capture. It offers outstanding narrative control, accurately interpreting and expressing micro-expression changes; features rich cinematic language, smooth camera movements, and strong visual tension. Widely applicable to film and animation, advertising and e-commerce, short dramas, and cultural tourism industries.',
    displayName: 'Vidu Q2 Turbo Text-to-Video',
    id: 'vidu/viduq2_text2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '960x528',
          '528x960',
          '720x720',
          '816x608',
          '608x816',
          '1280x720',
          '720x1280',
          '960x960',
          '1104x816',
          '816x1104',
          '1920x1080',
          '1080x1920',
          '1440x1440',
          '1674x1238',
          '1238x1674',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.21875, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input an image and a text description to generate video. ViduQ3-Pro image-to-video is a flagship-level audio-visual native model. It supports up to 16 seconds of synchronized audio-visual generation, enabling free multi-shot switching while precisely controlling pacing, emotion, and narrative continuity. With a leading parameter scale, it delivers exceptional image quality, character consistency, and emotional expression, meeting cinematic standards. Ideal for professional production scenarios such as advertising (e-commerce, TVC, performance campaigns), animated series, live-action drama, and games.',
    displayName: 'Vidu Q3 Pro Image-to-Video',
    enabled: true,
    id: 'vidu/viduq3-pro_img2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.78125, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input an image and a text description to generate video. ViduQ3-Turbo image-to-video is a high-performance accelerated model. It offers extremely fast generation while maintaining high-quality visuals and dynamic expression, excelling in action scenes, emotional rendering, and semantic understanding. Cost-effective and ideal for casual entertainment scenarios such as social media images, AI companions, and special effects assets.',
    displayName: 'Vidu Q3 Turbo Image-to-Video',
    id: 'vidu/viduq3-turbo_img2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.375, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input an image and a text description to generate video. ViduQ2-Pro image-to-video is the world’s first “Everything Can Be Referenced” video model. It supports six reference dimensions—effects, expressions, textures, actions, characters, and scenes—enabling fully evolved video editing. Through controllable addition, deletion, and modification, it achieves fine-grained video editing, designed as a production-grade creation engine for animated series, short dramas, and film production.',
    displayName: 'Vidu Q2 Pro Image-to-Video',
    id: 'vidu/viduq2-pro_img2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.34375, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input an image and a text description to generate video. ViduQ2-Turbo image-to-video is an ultra-fast generation engine. A 5-second 720P video can be generated in as little as 19 seconds, and a 5-second 1080P video in about 27 seconds. Character actions and expressions are natural and realistic, delivering strong authenticity and excellent performance in high-dynamic scenes such as action sequences, with wide-ranging motion.',
    displayName: 'Vidu Q2 Turbo Image-to-Video',
    id: 'vidu/viduq2-turbo_img2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.25, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input the first and last frame images along with a text description to generate video. ViduQ3-Pro keyframe-to-video is a flagship-level audio-visual native model. It supports up to 16 seconds of synchronized audio-visual generation, enabling free multi-shot switching while precisely controlling pacing, emotion, and narrative continuity. With a leading parameter scale, it delivers exceptional image quality, character consistency, and emotional expression, meeting cinematic standards. Ideal for professional production scenarios such as advertising (e-commerce, TVC, performance campaigns), animated series, live-action drama, and games.',
    displayName: 'Vidu Q3 Pro Start-to-End Video',
    enabled: true,
    id: 'vidu/viduq3-pro_start-end2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.78125, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input the first and last frame images along with a text description to generate video. ViduQ3-Turbo keyframe-to-video is a high-performance accelerated model. It delivers extremely fast generation while maintaining high-quality visuals and dynamic expression, excelling in action scenes, emotional rendering, and semantic understanding. Cost-effective and ideal for casual entertainment scenarios such as social media images, AI companions, and special effects assets.',
    displayName: 'Vidu Q3 Turbo Start-to-End Video',
    id: 'vidu/viduq3-turbo_start-end2video',
    parameters: {
      duration: { default: 5, max: 16, min: 1 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.375, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input the first and last frame images along with a text description to generate video. ViduQ2-Pro keyframe-to-video is the world’s first “Everything Can Be Referenced” video model. It supports six reference dimensions—effects, expressions, textures, actions, characters, and scenes—enabling fully evolved video editing. Through controllable addition, deletion, and modification, it achieves fine-grained video editing, designed as a production-grade creation engine for animated series, short dramas, and film production.',
    displayName: 'Vidu Q2 Pro Start-to-End Video',
    id: 'vidu/viduq2-pro_start-end2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.34375, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input the first and last frame images along with a text description to generate video. ViduQ2-Turbo keyframe-to-video is an ultra-fast generation engine. A 5-second 720P video can be produced in as little as 19 seconds, and a 5-second 1080P video in about 27 seconds. Character actions and expressions are natural and realistic, with strong authenticity, excelling in high-dynamic scenes such as action sequences, and supporting wide-ranging motion.',
    displayName: 'Vidu Q2 Turbo Start-to-End Video',
    id: 'vidu/viduq2-turbo_start-end2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      endImageUrl: {
        default: null,
      },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.25, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input reference videos, images, and a text description to generate video. ViduQ2-Pro reference-to-video is the world’s first “Everything Can Be Referenced” video model. It supports six reference dimensions—effects, expressions, textures, actions, characters, and scenes—enabling fully evolved video editing. Through controllable addition, deletion, and modification, it achieves fine-grained video editing, designed as a production-grade creation engine for animated series, short dramas, and film production.',
    displayName: 'Vidu Q2 Pro Reference-to-Video',
    id: 'vidu/viduq2-pro_reference2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '960x540',
          '720x540',
          '540x540',
          '540x720',
          '540x960',
          '1280x720',
          '960x720',
          '720x720',
          '720x960',
          '720x1280',
          '1920x1080',
          '1440x1080',
          '1080x1080',
          '1080x1440',
          '1080x1920',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.3125, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Input reference images along with a text description to generate video. ViduQ2 reference-to-video is a model designed for precise instruction adherence and nuanced emotion capture. It offers outstanding narrative control, accurately interpreting and expressing micro-expression changes; features rich cinematic language, smooth camera movements, and strong visual tension. Widely applicable to film and animation, advertising and e-commerce, short dramas, and cultural tourism industries.',
    displayName: 'Vidu Q2 Reference-to-Video',
    id: 'vidu/viduq2_reference2video',
    parameters: {
      duration: { default: 5, max: 10, min: 1 },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['540P', '720P', '1080P'],
      },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '960x540',
          '720x540',
          '540x540',
          '540x720',
          '540x960',
          '1280x720',
          '960x720',
          '720x720',
          '720x960',
          '720x1280',
          '1920x1080',
          '1440x1080',
          '1080x1080',
          '1080x1440',
          '1080x1920',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.28125, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'C1 is a large-scale model for the film and television industry launched by PixVerse in late March 2026. Its t2v (text-to-video) capability enables precise control over video generation through prompts, accurately reproducing various cinematic language techniques such as push, pull, pan, tilt, and tracking shots, with smooth camera movements and well-controlled perspective transitions. The model supports up to 15-second video generation, includes music with direct video output, and supports multiple languages.',
    displayName: 'PixVerse C1 T2V',
    enabled: true,
    id: 'pixverse/pixverse-c1-t2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: true },
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '640x360',
          '640x480',
          '640x640',
          '480x640',
          '360x640',
          '640x432',
          '432x640',
          '640x288',
          '1024x576',
          '1024x768',
          '1024x1024',
          '768x1024',
          '576x1024',
          '1024x688',
          '688x1024',
          '1024x448',
          '1280x720',
          '1280x960',
          '1280x1280',
          '960x1280',
          '720x1280',
          '1200x800',
          '800x1200',
          '1280x560',
          '1920x1080',
          '1920x1440',
          '1808x1808',
          '1440x1920',
          '1080x1920',
          '1776x1184',
          '1184x1776',
          '1920x832',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.39, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-07',
    type: 'video',
  },
  {
    description:
      'V6 is PixVerse’s new model launched at the end of March 2026. Its t2v (text-to-video) model allows precise control of video visuals through prompts, accurately reproducing various cinematic techniques. Camera movements such as push, pull, pan, tilt, tracking, and follow are smooth and natural, with precise and controllable perspective switching. It supports up to 15-second videos, direct output of music and video, and multiple languages.',
    displayName: 'PixVerse V6 T2V',
    enabled: true,
    id: 'pixverse/pixverse-v6-t2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: true },
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '640x360',
          '640x480',
          '640x640',
          '480x640',
          '360x640',
          '640x432',
          '432x640',
          '640x288',
          '1024x576',
          '1024x768',
          '1024x1024',
          '768x1024',
          '576x1024',
          '1024x688',
          '688x1024',
          '1024x448',
          '1280x720',
          '1280x960',
          '1280x1280',
          '960x1280',
          '720x1280',
          '1200x800',
          '800x1200',
          '1280x560',
          '1920x1080',
          '1920x1440',
          '1808x1808',
          '1440x1920',
          '1080x1920',
          '1776x1184',
          '1184x1776',
          '1920x832',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.36, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-03-30',
    type: 'video',
  },
  {
    description:
      'Input a text description to generate high-quality videos with second-level speed and precise semantic alignment, supporting multiple styles. PixVerse V5.6 is a self-developed video generation large model by Aishi Technology, offering comprehensive upgrades in both text-to-video and image-to-video capabilities. The model significantly improves image clarity, stability in complex motion, and audio-visual synchronization. Lip-sync accuracy and natural emotional expression are enhanced in multi-character dialogue scenes. Composition, lighting, and texture consistency are also optimized, further raising overall generation quality. PixVerse V5.6 ranks in the top global tier on the Artificial Analysis text-to-video and image-to-video leaderboard.',
    displayName: 'PixVerse V5.6 T2V',
    id: 'pixverse/pixverse-v5.6-t2v',
    parameters: {
      duration: { default: 5, enum: [5, 8, 10] },
      generateAudio: { default: true },
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '640x360',
          '640x480',
          '640x640',
          '480x640',
          '360x640',
          '1024x576',
          '1024x768',
          '1024x1024',
          '768x1024',
          '576x1024',
          '1280x720',
          '1280x960',
          '1280x1280',
          '960x1280',
          '720x1280',
          '1920x1080',
          '1920x1440',
          '1808x1808',
          '1440x1920',
          '1080x1920',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.53, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'C1 is a large-scale model for the film and television industry launched by PixVerse in late March 2026. Its it2v (image-to-video) capability not only provides prompt controllability similar to t2v (text-to-video), but also preserves the color, saturation, scenes, and character features of reference images with high fidelity. Compared to V6, it offers enhanced prompt interpretation, stronger creativity, and delivers fight choreography and visual effects (such as spells) closer to professional cinematic standards. The model supports up to 15-second video generation, includes music with direct video output, and supports multiple languages. It is particularly well-suited for short-duration shots such as single-person close-ups, monologues, freeze-frame or slow-motion sequences, and transitional establishing shots.',
    displayName: 'PixVerse C1 IT2V',
    enabled: true,
    id: 'pixverse/pixverse-c1-it2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.39, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-07',
    type: 'video',
  },
  {
    description:
      'V6 is PixVerse’s new model launched at the end of March 2026. Its it2v (image-to-video) model ranks second globally. In addition to the prompt-control capabilities of t2v (text-to-video), it2v can accurately reproduce the colors, saturation, scenes, and character features of reference images, delivering stronger character emotions and high-speed motion performance. It supports up to 15-second videos, direct output of music and video, and multiple languages. Ideal for scenarios such as e-commerce product close-ups, advertising promos, and simulated C4D modeling to showcase product structures, with one-click direct output.',
    displayName: 'PixVerse V6 IT2V',
    enabled: true,
    id: 'pixverse/pixverse-v6-it2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.36, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-03-30',
    type: 'video',
  },
  {
    description:
      'Upload any image to freely customize the story, pacing, and style, generating vivid and coherent videos. PixVerse V5.6 is a self-developed video generation large model by Aishi Technology, offering comprehensive upgrades in both text-to-video and image-to-video capabilities. The model significantly enhances image clarity, stability in complex motion, and audio-visual synchronization. Lip-sync accuracy and natural emotional expression are improved in multi-character dialogue scenes. Composition, lighting, and texture consistency are also optimized, further elevating overall generation quality. PixVerse V5.6 ranks in the top global tier on the Artificial Analysis text-to-video and image-to-video leaderboard.',
    displayName: 'PixVerse V5.6 IT2V',
    id: 'pixverse/pixverse-v5.6-it2v',
    parameters: {
      duration: { default: 5, enum: [5, 8, 10] },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.53, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'C1 is a large-scale model for the film and television industry launched by PixVerse in late March 2026. Its kf2v (keyframe-to-video) capability enables smooth and natural transitions between any two input images. The model supports up to 15-second video generation, includes music with direct video output, and supports multiple languages.',
    displayName: 'PixVerse C1 KF2V',
    enabled: true,
    id: 'pixverse/pixverse-c1-kf2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.39, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-07',
    type: 'video',
  },
  {
    description:
      'V6 is PixVerse’s new model launched at the end of March 2026. Its kf2v (keyframe-to-video) model can seamlessly connect any two images, producing smoother and more natural video transitions. It supports up to 15-second videos, direct output of music and video, and multiple languages.',
    displayName: 'PixVerse V6 KF2V',
    enabled: true,
    id: 'pixverse/pixverse-v6-kf2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.36, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-03-30',
    type: 'video',
  },
  {
    description:
      'Achieve seamless transitions between any two images, creating smoother and more natural scene changes with visually striking effects. PixVerse V5.6 is a self-developed video generation large model by Aishi Technology, offering comprehensive upgrades in both text-to-video and image-to-video capabilities. The model significantly improves image clarity, stability in complex motion, and audio-visual synchronization. Lip-sync accuracy and natural emotional expression are enhanced in multi-character dialogue scenes. Composition, lighting, and texture consistency are also optimized, further elevating overall generation quality. PixVerse V5.6 ranks in the top global tier on the Artificial Analysis text-to-video and image-to-video leaderboard.',
    displayName: 'PixVerse V5.6 KF2V',
    id: 'pixverse/pixverse-v5.6-kf2v',
    parameters: {
      duration: { default: 5, enum: [5, 8, 10] },
      endImageUrl: {
        default: null,
      },
      generateAudio: { default: true },
      imageUrl: {
        default: null,
      },
      prompt: { default: '' },
      resolution: {
        default: '720P',
        enum: ['360P', '540P', '720P', '1080P'],
      },
      seed: { default: null },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.53, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'C1 is a large-scale model for the film and television industry launched by PixVerse in late March 2026. Its r2v (reference-to-video) capability supports inputting 2–7 images, intelligently blending multiple subjects while retaining prompt controllability similar to t2v (text-to-video), as well as the consistency and creativity of it2v (image-to-video). It delivers fight choreography and visual effects (e.g., spells and action sequences) closer to professional cinematic standards. The model supports up to 15-second video generation, includes music with direct video output, and handles multiple languages. It is well-suited for complex scenes such as multi-character group shots, dialogues, and interactions, particularly in medium and wide shots. If a single multi-panel storyboard image is provided (supporting up to a 9-panel grid), it can generate a continuous multi-shot video sequence in one click.',
    displayName: 'PixVerse C1 R2V',
    id: 'pixverse/pixverse-c1-r2v',
    parameters: {
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: true },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '640x360',
          '640x480',
          '640x640',
          '480x640',
          '360x640',
          '640x432',
          '432x640',
          '640x288',
          '1024x576',
          '1024x768',
          '1024x1024',
          '768x1024',
          '576x1024',
          '1024x688',
          '688x1024',
          '1024x448',
          '1280x720',
          '1280x960',
          '1280x1280',
          '960x1280',
          '720x1280',
          '1200x800',
          '800x1200',
          '1280x560',
          '1920x1080',
          '1920x1440',
          '1808x1808',
          '1440x1920',
          '1080x1920',
          '1776x1184',
          '1184x1776',
          '1920x832',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.39, strategy: 'fixed', unit: 'second' }],
    },
    releasedAt: '2026-04-07',
    type: 'video',
  },
  {
    description:
      'Input 2–7 images to intelligently merge different subjects while maintaining unified style and coordinated motion, easily building rich narrative scenes and enhancing content controllability and creative freedom. PixVerse V5.6 is a self-developed video generation large model by Aishi Technology, offering comprehensive upgrades in both text-to-video and image-to-video capabilities. The model significantly improves image clarity, stability in complex motion, and audio-visual synchronization. Lip-sync accuracy and natural emotional expression are enhanced in multi-character dialogue scenes. Composition, lighting, and texture consistency are also optimized, further elevating overall generation quality. PixVerse V5.6 ranks in the top global tier on the Artificial Analysis text-to-video and image-to-video leaderboard.',
    displayName: 'PixVerse V5.6 R2V',
    id: 'pixverse/pixverse-v5.6-r2v',
    parameters: {
      duration: { default: 5, enum: [5, 8, 10] },
      generateAudio: { default: true },
      imageUrls: {
        default: [],
        maxCount: 7,
      },
      prompt: { default: '' },
      seed: { default: null },
      size: {
        default: '1280x720',
        enum: [
          '640x360',
          '640x480',
          '640x640',
          '480x640',
          '360x640',
          '1024x576',
          '1024x768',
          '1024x1024',
          '768x1024',
          '576x1024',
          '1280x720',
          '1280x960',
          '1280x1280',
          '960x1280',
          '720x1280',
          '1920x1080',
          '1920x1440',
          '1808x1808',
          '1440x1920',
          '1080x1920',
        ],
      },
      watermark: { default: false },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'videoGeneration', rate: 0.53, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
];

export const allModels = [...qwenChatModels, ...qwenImageModels, ...qwenVideoModels];

export default allModels;
