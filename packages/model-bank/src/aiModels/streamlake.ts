import type { AIChatModelCard } from '../types/aiModel';

const streamlakeModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'The latest high-performance model from the Kuaishou Kwaipilot team, designed for complex enterprise projects and SaaS integration. It excels in code-related scenarios and is compatible with various types of agent frameworks (Claude Code, OpenCode, KiloCode), natively supports OpenClaw, and is optimized specifically for front-end page aesthetics.',
    displayName: 'KAT-Coder-Pro-V2',
    enabled: true,
    id: 'KAT-Coder-Pro-V2',
    maxOutput: 81_920,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Designed for Agentic Coding, it comprehensively covers programming tasks and scenarios, achieving intelligent behavior emergence through large-scale reinforcement learning, significantly outperforming similar models in code writing performance.',
    displayName: 'KAT-Coder-Pro-V1',
    id: 'KAT-Coder-Pro-V1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-23',
    type: 'chat',
  },
  {
    abilities: {
      structuredOutput: true,
    },
    contextWindowTokens: 131_072,
    description:
      'KAT-Coder-Exp-72B is the RL innovation experimental version in the KAT-Coder series, achieving a remarkable performance of 74.6% on the SWE-Bench verified benchmark, setting a new record for open-source models. It focuses on Agentic Coding and currently only supports the SWE-Agent scaffold, but can also be used for simple conversations.',
    displayName: 'KAT-Coder-Exp-72B-1010',
    id: 'KAT-Coder-Exp-72B-1010',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      structuredOutput: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A lightweight version within the KAT-Coder series. Specifically designed for Agentic Coding, it comprehensively covers programming tasks and scenarios. Leveraging large-scale agent-based reinforcement learning, it enables emergent intelligent behaviors and significantly outperforms comparable models in coding performance.',
    displayName: 'KAT-Coder-Air-V1',
    enabled: true,
    id: 'KAT-Coder-Air-V1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5-Turbo is a foundation model deeply optimized for agentic scenarios. It has been specifically optimized for core requirements of agent tasks from the training phase, enhancing key capabilities such as tool invocation, command following, and long-chain execution. It is ideal for building high-performance agent assistants.',
    displayName: 'GLM-5-Turbo',
    id: 'GLM-5-Turbo',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, infinity]': 1.8,
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
    releasedAt: '2026-03-15',
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
      'GLM-5 is Zhipu’s next-generation flagship foundation model, purpose-built for Agentic Engineering. It delivers reliable productivity in complex systems engineering and long-horizon agentic tasks. In coding and agent capabilities, GLM-5 achieves state-of-the-art performance among open-source models. In real-world programming scenarios, its user experience approaches that of Claude Opus 4.5. It excels at complex systems engineering and long-horizon agent tasks, making it an ideal foundation model for general-purpose agent assistants.',
    displayName: 'GLM-5',
    id: 'GLM-5',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1,
              '[0.032, infinity]': 1.5,
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
    releasedAt: '2026-02-12',
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
    contextWindowTokens: 204_800,
    description:
      'First self-evolving model with top-tier coding and agentic performance (~60 tps).',
    displayName: 'MiniMax M2.7',
    id: 'MiniMax-M2.7',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 204_800,
    description:
      'Top-tier performance and ultimate cost-effectiveness, easily handling complex tasks (approx. 60 tps).',
    displayName: 'MiniMax M2.5',
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.21, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.625, strategy: 'fixed', unit: 'millionTokens' },
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
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is the most capable Kimi model, delivering open-source SOTA in agent tasks, coding, and vision understanding. It supports multimodal inputs and both thinking and non-thinking modes.',
    displayName: 'Kimi K2.5',
    id: 'Kimi-K2.5',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
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
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.5 Plus supports text, image, and video input. Its performance on pure text tasks is comparable to Qwen3 Max, with better performance and lower cost. Its multimodal capabilities are significantly improved compared to the Qwen3 VL series.',
    displayName: 'Qwen3.5 Plus',
    id: 'Qwen3.5-Plus',
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
    contextWindowTokens: 1_000_000,
    description:
      'MiMo-V2-Pro is specifically designed for high-intensity agent workflows in real-world scenarios. It features over 1 trillion total parameters (42B activated parameters), adopts an innovative hybrid attention architecture, and supports an ultra-long context length of up to 1 million tokens. Built on a powerful foundational model, we continuously scale computational resources across a broader range of agent scenarios, further expanding the action space of intelligence and achieving significant generalization—from coding to real-world task execution (“claw”).',
    displayName: 'MiMo-V2 Pro',
    id: 'MiMo-V2-Pro',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 0.256 },
            { rate: 14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 21, upTo: 0.256 },
            { rate: 42, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-18',
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
    contextWindowTokens: 131_072,
    description:
      'deepseek-v3.2 introduces sparse attention mechanism, aiming to improve training and inference efficiency when processing long texts, priced lower than deepseek-v3.1.',
    displayName: 'DeepSeek V3.2',
    id: 'DeepSeek-V3.2',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-01',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'DeepSeek-OCR is a vision-language model from DeepSeek AI focused on OCR and "context optical compression." It explores compressing context from images, efficiently processes documents, and converts them to structured text (e.g., Markdown). It accurately recognizes text in images, suited for document digitization, text extraction, and structured processing.',
    displayName: 'DeepSeek OCR',
    id: 'DeepSeek-OCR',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.216, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.216, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-20',
    type: 'chat',
  },
];

export const allModels = [...streamlakeModels];

export default allModels;
