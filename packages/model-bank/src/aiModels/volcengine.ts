import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://www.volcengine.com/docs/82379/1330310

const doubaoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-8-251228',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.8 has stronger multimodal understanding and Agent capabilities, supports text/image/video input and context caching, and can deliver excellent performance in complex tasks.',
    displayName: 'Doubao Seed 1.8',
    enabled: true,
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-code-preview-251028',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code is deeply optimized for agentic coding, supports multimodal inputs (text/image/video) and a 256k context window, is compatible with the Anthropic API, and fits coding, vision understanding, and agent workflows.',
    displayName: 'Doubao Seed Code',
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
    enabled: true,
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
    },
    config: {
      deploymentName: 'deepseek-v3-1-terminus',
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3.1 is a new hybrid reasoning model from DeepSeek, supporting both thinking and non-thinking modes and offering higher thinking efficiency than DeepSeek-R1-0528. Post-training optimizations greatly improve agent tool use and agent-task performance. It supports a 128k context window and up to 64k output tokens.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    config: {
      deploymentName: 'kimi-k2-250905',
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi-K2 is a MoE base model from Moonshot AI with strong coding and agent capabilities, totaling 1T parameters with 32B active. On benchmarks for general reasoning, coding, math, and agent tasks, it outperforms other mainstream open models.',
    displayName: 'Kimi K2',
    id: 'kimi-k2',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-vision-250815',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-vision is a visual deep-reasoning model that delivers stronger multimodal understanding and reasoning for education, image review, inspection/security, and AI search Q&A. It supports a 256k context window and up to 64k output tokens.',
    displayName: 'Doubao Seed 1.6 Vision',
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-thinking-250715',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-thinking significantly strengthens reasoning, further improving core abilities in coding, math, and logical reasoning over Doubao-1.5-thinking-pro, while adding vision understanding. It supports a 256k context window and up to 16k output tokens.',
    displayName: 'Doubao Seed 1.6 Thinking',
    id: 'doubao-seed-1.6-thinking',
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-251015',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6 is a new multimodal deep-reasoning model with auto, thinking, and non-thinking modes. In non-thinking mode, it significantly outperforms Doubao-1.5-pro/250115. It supports a 256k context window and up to 16k output tokens.',
    displayName: 'Doubao Seed 1.6',
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-lite-251015',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-lite is a new multimodal deep-reasoning model with adjustable reasoning effort (Minimal, Low, Medium, High), delivering better value and a strong choice for common tasks, with a context window up to 256k.',
    displayName: 'Doubao Seed 1.6 Lite',
    id: 'doubao-seed-1.6-lite',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.3,
              '[0.032, 0.128]': 0.6,
              '[0.128, 0.256]': 1.2,
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
              '[0, 0.032]_[0, 0.0002]': 0.6,
              '[0, 0.032]_[0.0002, infinity]': 2.4,
              '[0.032, 0.128]_[0, infinity]': 4,
              '[0.128, 0.256]_[0, infinity]': 12,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-flash-250828',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-flash is an ultra-fast multimodal deep-reasoning model with TPOT as low as 10ms. It supports both text and vision, surpasses the previous lite model in text understanding, and matches competing pro models in vision. It supports a 256k context window and up to 16k output tokens.',
    displayName: 'Doubao Seed 1.6 Flash',
    enabled: true,
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
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-ui-tars-250428',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5-UI-TARS is a native GUI-focused agent model that seamlessly interacts with interfaces through human-like perception, reasoning, and action.',
    displayName: 'Doubao 1.5 UI TARS',
    id: 'doubao-1.5-ui-tars',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-vision-pro-250428',
    },
    contextWindowTokens: 131_072,
    description:
      'A new visual deep-reasoning model with stronger multimodal understanding and reasoning, achieving SOTA results on 37 of 59 public benchmarks.',
    displayName: 'Doubao 1.5 Thinking Vision Pro',
    id: 'doubao-1.5-thinking-vision-pro',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-pro-250415',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5 is a new deep-reasoning model that excels in math, coding, scientific reasoning, and general tasks like creative writing. It reaches or approaches top-tier results on benchmarks such as AIME 2024, Codeforces, and GPQA. It supports a 128k context window and 16k output.',
    displayName: 'Doubao 1.5 Thinking Pro',
    id: 'doubao-1.5-thinking-pro',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-pro-m-250428',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5 is a new deep-reasoning model (the m version includes native multimodal deep reasoning) that excels in math, coding, scientific reasoning, and general tasks like creative writing. It reaches or approaches top-tier results on benchmarks such as AIME 2024, Codeforces, and GPQA. It supports a 128k context window and 16k output.',
    displayName: 'Doubao 1.5 Thinking Pro M',
    id: 'doubao-1.5-thinking-pro-m',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'deepseek-r1-250528',
    },
    contextWindowTokens: 131_072,
    description:
      'The latest 0528 release of DeepSeek-R1 applies large-scale reinforcement learning in post-training, greatly boosting reasoning with very little labeled data. It matches the OpenAI o1 production model on math, code, and natural language reasoning tasks.',
    displayName: 'DeepSeek R1',
    id: 'deepseek-r1',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'deepseek-r1-distill-qwen-32b-250120',
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-R1-Distill models are fine-tuned from open-source models using sample data generated by DeepSeek-R1.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'deepseek-r1-distill-qwen-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'deepseek-r1-distill-qwen-7b-250120',
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-R1-Distill models are fine-tuned from open-source models using sample data generated by DeepSeek-R1.',
    displayName: 'DeepSeek R1 Distill Qwen 7B',
    id: 'deepseek-r1-distill-qwen-7b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'deepseek-v3-250324',
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3 is a MoE model developed by DeepSeek. It surpasses other open models like Qwen2.5-72B and Llama-3.1-405B on many benchmarks, and is competitive with leading closed models such as GPT-4o and Claude 3.5 Sonnet.',
    displayName: 'DeepSeek V3',
    id: 'deepseek-v3',
    maxOutput: 16_384,
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
      functionCall: true,
    },
    config: {
      deploymentName: 'doubao-1-5-pro-32k-250115',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-pro is a new-generation flagship model with across-the-board upgrades, excelling in knowledge, coding, and reasoning.',
    displayName: 'Doubao 1.5 Pro 32k',
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
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-pro-32k-250115',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-1.5-vision-pro is an upgraded multimodal model that supports images at any resolution and extreme aspect ratios, enhancing visual reasoning, document recognition, detail understanding, and instruction following.',
    displayName: 'Doubao 1.5 Vision Pro 32k',
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
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-pro-250328',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-vision-pro is an upgraded multimodal model that supports images at any resolution and extreme aspect ratios, enhancing visual reasoning, document recognition, detail understanding, and instruction following.',
    displayName: 'Doubao 1.5 Vision Pro',
    id: 'doubao-1.5-vision-pro',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-lite-250315',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-vision-lite is an upgraded multimodal model that supports images at any resolution and extreme aspect ratios, enhancing visual reasoning, document recognition, detail understanding, and instruction following. It supports a 128k context window and up to 16k output tokens.',
    displayName: 'Doubao 1.5 Vision Lite',
    id: 'doubao-1.5-vision-lite',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-15',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'doubao-vision-pro-32k-241028',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-vision is a multimodal model from Doubao with strong image understanding and reasoning plus accurate instruction following. It performs well on image-text extraction and image-based reasoning tasks, enabling more complex and broader visual QA scenarios.',
    displayName: 'Doubao Vision Pro 32k',
    id: 'doubao-vision-pro-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-28',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    config: {
      deploymentName: 'doubao-vision-lite-32k-241015',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-vision is a multimodal model from Doubao with strong image understanding and reasoning plus accurate instruction following. It performs well on image-text extraction and image-based reasoning tasks, enabling more complex and broader visual QA scenarios.',
    displayName: 'Doubao Vision Lite 32k',
    id: 'doubao-vision-lite-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-15',
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'doubao-lite-4k-character-240828',
    },
    contextWindowTokens: 4096,
    description:
      'Ultra-fast response with better value, offering more flexible choices across scenarios. Supports reasoning and fine-tuning with a 4k context window.',
    displayName: 'Doubao Lite 4k',
    id: 'doubao-lite-4k',
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
      deploymentName: 'doubao-lite-32k-240828',
    },
    contextWindowTokens: 32_768,
    description:
      'Ultra-fast response with better value, offering more flexible choices across scenarios. Supports reasoning and fine-tuning with a 32k context window.',
    displayName: 'Doubao Lite 32k',
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
      deploymentName: 'doubao-lite-128k-240828',
    },
    contextWindowTokens: 128_000,
    description:
      'Ultra-fast response with better value, offering more flexible choices across scenarios. Supports reasoning and fine-tuning with a 128k context window.',
    displayName: 'Doubao Lite 128k',
    id: 'doubao-lite-128k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
  {
    config: {
      deploymentName: 'doubao-pro-256k-241115',
    },
    contextWindowTokens: 256_000,
    description:
      'The best-performing flagship model for complex tasks, with strong results in reference QA, summarization, creation, text classification, and roleplay. Supports reasoning and fine-tuning with a 256k context window.',
    displayName: 'Doubao Pro 256k',
    id: 'doubao-pro-256k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const volcengineImageModels: AIImageModelCard[] = [
  {
    /*
    // TODO: AIImageModelCard does not support config.deploymentName
    config: {
      deploymentName: 'doubao-seedream-3-0-t2i-250415',
    },
    */
    description:
      'Seedream 4.0 is an image generation model from ByteDance Seed, supporting text and image inputs with highly controllable, high-quality image generation. It generates images from text prompts.',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'doubao-seedream-4-0-250828',
    parameters: {
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: [
          '2048x2048',
          '2304x1728',
          '1728x2304',
          '2560x1440',
          '1440x2560',
          '2496x1664',
          '1664x2496',
          '3024x1296',
        ],
      },
    },
    releasedAt: '2025-09-09',
    type: 'image',
  },
  {
    /*
    // TODO: AIImageModelCard does not support config.deploymentName
    config: {
      deploymentName: 'doubao-seedream-3-0-t2i-250415',
    },
    */
    description:
      'Seedream 3.0 is an image generation model from ByteDance Seed, supporting text and image inputs with highly controllable, high-quality image generation. It generates images from text prompts.',
    displayName: 'Seedream 3.0 Text-to-Image',
    enabled: true,
    id: 'doubao-seedream-3-0-t2i-250415',
    parameters: {
      cfg: { default: 2.5, max: 10, min: 1, step: 0.1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: [
          '1024x1024',
          '864x1152',
          '1152x864',
          '1280x720',
          '720x1280',
          '832x1248',
          '1248x832',
          '1512x648',
        ],
      },
    },
    releasedAt: '2025-04-15',
    type: 'image',
  },
  // Note: Doubao image-to-image and text-to-image models share the same Endpoint, currently switches to edit endpoint if imageUrl exists
  {
    // config: {
    //   deploymentName: 'doubao-seededit-3-0-i2i-250628',
    // },
    description:
      'The Doubao image model from ByteDance Seed supports text and image inputs with highly controllable, high-quality image generation. It supports text-guided image editing, with output sizes between 512 and 1536 on the long side.',
    displayName: 'SeedEdit 3.0 Image-to-Image',
    enabled: true,
    id: 'doubao-seededit-3-0-i2i-250628',
    parameters: {
      cfg: { default: 5.5, max: 10, min: 1, step: 0.1 },
      imageUrl: { default: null, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    releasedAt: '2025-06-28',
    type: 'image',
  },
];

export const allModels = [...doubaoChatModels, ...volcengineImageModels];

export default allModels;
