import type { AIChatModelCard } from '../types/aiModel';

// https://cloud.infini-ai.com/genstudio/model

const infiniaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2 Thinking is the latest and most powerful open-source reasoning model. It significantly expands multi-step reasoning depth and maintains stable tool use across 200-300 consecutive tool calls, setting new records on Humanity's Last Exam (HLE), BrowseComp, and other benchmarks. It also excels in coding, math, logical reasoning, and agent scenarios. Built on a MoE architecture with about 1T total parameters, it supports a 256K context window and tool calling.",
    displayName: 'Kimi K2 Thinking',
    id: 'kimi-k2-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-07',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'DeepSeek-OCR is a vision-language model from DeepSeek AI focused on OCR and "contextual optical compression." It explores compressing contextual information from images, efficiently processes documents, and converts them into structured text formats such as Markdown. It accurately recognizes text in images, making it ideal for document digitization, text extraction, and structured processing.',
    displayName: 'DeepSeek OCR',
    id: 'deepseek-ocr',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-20',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'MiniMax-M2.1 is the latest version of the MiniMax series, optimized for multilingual programming and real-world complex tasks. As an AI-native model, MiniMax-M2.1 achieves significant improvements in model performance, agent framework support, and multi-scenario adaptation, aiming to help enterprises and individuals find AI-native work and lifestyle more quickly.',
    displayName: 'MiniMax M2.1',
    enabled: true,
    id: 'minimax-m2.1',
    maxOutput: 200_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'MiniMax-M2 is a Mixture of Experts (MoE) language model optimized for coding and agent workflows, with approximately 230B total parameters and approximately 10B active parameters. While maintaining strong general intelligence, it is deeply enhanced for developer scenarios such as multi-file editing, code-run-fix loops, and test validation fixes, demonstrating stable and efficient performance in real environments like terminals, IDEs, and CI.',
    displayName: 'MiniMax M2',
    id: 'minimax-m2',
    maxOutput: 200_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
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
      'GLM-4.7 is the latest large language model launched by Zhipu AI, with enhanced reasoning and generation capabilities.',
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'glm-4.7',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4.6 is the latest large language model launched by Zhipu AI, with enhanced reasoning and generation capabilities.',
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3.2-Exp is an experimental DeepSeek LLM with stronger reasoning and generation.',
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
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B A22B Instruct is a multimodal model from Qwen, supporting vision understanding and reasoning.',
    displayName: 'Qwen3 VL 235B A22B Instruct',
    id: 'qwen3-vl-235b-a22b-instruct',
    maxOutput: 32_768,
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B A22B Thinking is a multimodal reasoning model from Qwen, supporting vision understanding and reasoning.',
    displayName: 'Qwen3 VL 235B A22B Thinking',
    id: 'qwen3-vl-235b-a22b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-V3.1-Terminus is a terminal-optimized LLM from DeepSeek, tailored for terminal devices.',
    displayName: 'DeepSeek V3.1 Terminus',
    id: 'deepseek-v3.1-terminus',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A next-generation thinking-mode open-source model based on Qwen3. Compared to the previous version (Qwen3-235B-A22B-Thinking-2507), it improves instruction following and provides more concise summaries.',
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'qwen3-next-80b-a3b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A next-generation non-thinking open-source model based on Qwen3. Compared to the previous version (Qwen3-235B-A22B-Instruct-2507), it has better Chinese text understanding, stronger logical reasoning, and improved text generation performance.',
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'qwen3-next-80b-a3b-instruct',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek V3.1 uses a hybrid reasoning architecture with both thinking and non-thinking modes.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
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
      reasoning: true,
    },
    contextWindowTokens: 64_000,
    description: 'Baichuan M2 32B is a MoE model from Baichuan Intelligence with strong reasoning.',
    displayName: 'Baichuan M2 32B',
    id: 'baichuan-m2-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 11.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5V is a multimodal model from Zhipu AI for vision understanding and reasoning.',
    displayName: 'GLM-4.5V',
    id: 'glm-4.5v',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5 is a hybrid reasoning model from Zhipu AI built for agents, with thinking and non-thinking modes.',
    displayName: 'GLM-4.5',
    id: 'glm-4.5',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'GLM-4.5-Air is a lightweight LLM from Zhipu AI with efficient reasoning.',
    displayName: 'GLM-4.5-Air',
    id: 'glm-4.5-air',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'The open-source Qwen code model. The latest qwen3-coder-480b-a35b-instruct is a Qwen3-based code generation model with strong coding-agent capabilities, good at tool use and environment interaction, enabling autonomous programming while retaining strong general abilities.',
    displayName: 'Qwen3 Coder 480B A35B',
    id: 'qwen3-coder-480b-a35b-instruct',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 36, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'A non-thinking open-source model based on Qwen3. Compared to the previous version (Qwen3-235B-A22B), it slightly improves subjective creative ability and model safety.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'qwen3-235b-a22b-instruct-2507',
    maxOutput: 8192,
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
    contextWindowTokens: 131_072,
    description: 'Kimi K2 Instruct is a Moonshot AI LLM with ultra-long context handling.',
    displayName: 'Kimi K2 Instruct',
    id: 'kimi-k2-instruct',
    maxOutput: 32_768,
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
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'ERNIE 4.5 300B A47B is Baidu ERNIE’s ultra-large MoE model with excellent reasoning.',
    displayName: 'ERNIE 4.5 300B A47B',
    id: 'ernie-4.5-300b-a47b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 120_000,
    description:
      'ERNIE 4.5 21B A3B is Baidu ERNIE’s MoE model with strong reasoning and multilingual abilities.',
    displayName: 'ERNIE 4.5 21B A3B',
    id: 'ernie-4.5-21b-a3b',
    maxOutput: 8192,
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
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-8B is the third-generation Qwen LLM with 8.2B parameters, designed for efficient reasoning and multilingual tasks. It supports seamless switching between thinking mode (complex reasoning) and non-thinking mode (general chat), excelling in math, coding, commonsense reasoning, and multilingual instruction following.',
    displayName: 'Qwen3 8B',
    id: 'qwen3-8b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3-14B is the third-generation Qwen LLM with 14.8B parameters, designed for efficient reasoning and multilingual tasks. It supports seamless switching between thinking mode (complex reasoning) and non-thinking mode (general chat), excelling in math, coding, commonsense reasoning, and multilingual instruction following.',
    displayName: 'Qwen3 14B',
    id: 'qwen3-14b',
    maxOutput: 8192,
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-32B is the third-generation Qwen LLM with 32.8B parameters, designed for efficient reasoning and multilingual tasks. It supports seamless switching between thinking mode (complex reasoning) and non-thinking mode (general chat), excelling in math, coding, commonsense reasoning, and multilingual instruction following.',
    displayName: 'Qwen3 32B',
    id: 'qwen3-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 11.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3-30B-A3B is a third-generation Qwen LLM using a MoE architecture with 30.5B total parameters and 3.3B active per token. It supports seamless switching between thinking mode (complex reasoning) and non-thinking mode (general chat), excelling in math, coding, commonsense reasoning, and multilingual instruction following.',
    displayName: 'Qwen3 30B A3B',
    id: 'qwen3-30b-a3b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.7, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3-235B-A22B is a third-generation Qwen LLM using a MoE architecture with 235B total parameters and 22B active per token. It supports seamless switching between thinking mode (complex reasoning) and non-thinking mode (general chat), excelling in math, coding, commonsense reasoning, and multilingual instruction following.',
    displayName: 'Qwen3 235B A22B',
    id: 'qwen3-235b-a22b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 125_000,
    description:
      'The Qwen2.5-VL series improves intelligence, practicality, and applicability, performing better in natural dialogue, content creation, professional knowledge services, and code development. The flagship Qwen2.5-VL-72B-Instruct is highly competitive across benchmarks spanning many domains and tasks, including college-level QA, math, document understanding, general QA, video understanding, and visual agent tasks.',
    displayName: 'Qwen2.5 VL 72B Instruct',
    id: 'qwen2.5-vl-72b-instruct',
    maxOutput: 4096,
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
      vision: true,
    },
    contextWindowTokens: 125_000,
    description:
      'The Qwen2.5-VL series improves intelligence, practicality, and applicability, performing better in natural dialogue, content creation, professional knowledge services, and code development. Qwen2.5-VL-32B-Instruct is highly competitive across benchmarks spanning many domains and tasks, including college-level QA, math, document understanding, general QA, video understanding, and visual agent tasks.',
    displayName: 'Qwen2.5 VL 32B Instruct',
    id: 'qwen2.5-vl-32b-instruct',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 125_000,
    description:
      'The Qwen2.5-VL series improves intelligence, practicality, and applicability, performing better in natural dialogue, content creation, professional knowledge services, and code development. Qwen2.5-VL-7B-Instruct is highly competitive across benchmarks spanning many domains and tasks, including college-level QA, math, document understanding, general QA, video understanding, and visual agent tasks.',
    displayName: 'Qwen2.5 VL 7B Instruct',
    id: 'qwen2.5-vl-7b-instruct',
    maxOutput: 4096,
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
    },
    contextWindowTokens: 32_000,
    description: 'QwQ 32B is a Qwen reasoning-focused model built for reasoning tasks.',
    displayName: 'QwQ 32B',
    id: 'qwq-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3-0324 is a powerful MoE LLM with 671B total parameters and 37B active per token. It uses Multi-Head Latent Attention (MLA) and the DeepSeekMoE architecture for efficient reasoning and economical training, and significantly improves over the previous DeepSeek-V3.',
    displayName: 'DeepSeek V3 0324',
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1 is an LLM focused on reasoning, achieving performance comparable to OpenAI o1 on math, code, and reasoning tasks through an innovative training pipeline. It is trained with a combination of cold-start data and large-scale reinforcement learning.',
    displayName: 'DeepSeek R1',
    id: 'deepseek-r1',
    maxOutput: 32_768,
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
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description: 'DeepSeek R1 Distill Qwen 32B is a DeepSeek distilled model based on Qwen.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'deepseek-r1-distill-qwen-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description: 'Megrez 3B Instruct is a small, efficient model from Wuwen Xinqiong.',
    displayName: 'Megrez 3B Instruct',
    id: 'megrez-3b-instruct',
    maxOutput: 4096,
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
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is the latest in the Qwen LLM series. It releases base and instruction-tuned models ranging from 0.5B to 72B parameters. Compared with Qwen2, Qwen2.5 brings:\nSignificantly more knowledge, with major gains in coding and math.\nStronger instruction following, long-text generation, structured data understanding (e.g., tables), and structured output especially JSON. More robust to diverse system prompts, improving roleplay and conditioning in chatbots.\nLong-context support.\nMultilingual support for 29+ languages, including Chinese, English, French, Spanish, Portuguese, German, Italian, Russian, Japanese, Korean, Vietnamese, Thai, Arabic, and more.',
    displayName: 'Qwen2.5 32B Instruct',
    id: 'qwen2.5-32b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is the latest in the Qwen LLM series. It releases base and instruction-tuned models ranging from 0.5B to 72B parameters. Compared with Qwen2, Qwen2.5 brings:\nSignificantly more knowledge, with major gains in coding and math.\nStronger instruction following, long-text generation, structured data understanding (e.g., tables), and structured output especially JSON. More robust to diverse system prompts, improving roleplay and conditioning in chatbots.\nLong-context support.\nMultilingual support for 29+ languages, including Chinese, English, French, Spanish, Portuguese, German, Italian, Russian, Japanese, Korean, Vietnamese, Thai, Arabic, and more.',
    displayName: 'Qwen2.5 72B Instruct',
    id: 'qwen2.5-72b-instruct',
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
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is the latest in the Qwen LLM series. It releases base and instruction-tuned models ranging from 0.5B to 72B parameters. Compared with Qwen2, Qwen2.5 brings:\nSignificantly more knowledge, with major gains in coding and math.\nStronger instruction following, long-text generation, structured data understanding (e.g., tables), and structured output especially JSON. More robust to diverse system prompts, improving roleplay and conditioning in chatbots.\nLong-context support.\nMultilingual support for 29+ languages, including Chinese, English, French, Spanish, Portuguese, German, Italian, Russian, Japanese, Korean, Vietnamese, Thai, Arabic, and more.',
    displayName: 'Qwen2.5 14B Instruct',
    id: 'qwen2.5-14b-instruct',
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
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is the latest in the Qwen LLM series. It releases base and instruction-tuned models ranging from 0.5B to 72B parameters. Compared with Qwen2, Qwen2.5 brings:\nSignificantly more knowledge, with major gains in coding and math.\nStronger instruction following, long-text generation, structured data understanding (e.g., tables), and structured output especially JSON. More robust to diverse system prompts, improving roleplay and conditioning in chatbots.\nLong-context support.\nMultilingual support for 29+ languages, including Chinese, English, French, Spanish, Portuguese, German, Italian, Russian, Japanese, Korean, Vietnamese, Thai, Arabic, and more.',
    displayName: 'Qwen2.5 7B Instruct',
    id: 'qwen2.5-7b-instruct',
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
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder is the latest code-focused Qwen LLM series. Compared to CodeQwen1.5, it brings:\nSignificant improvements in code generation, code reasoning, and code repair.\nSupport for real-world applications such as code agents, improving coding plus math and general abilities.\nLong-context support.',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    id: 'qwen2.5-coder-32b-instruct',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Access requires an application. GPT-OSS-120B is an open-source large language model from OpenAI with strong text generation capability.',
    displayName: 'GPT-OSS-120B',
    id: 'gpt-oss-120b',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Access requires an application. GPT-OSS-20B is an open-source mid-size language model from OpenAI with efficient text generation.',
    displayName: 'GPT-OSS-20B',
    id: 'gpt-oss-20b',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
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
    },
    contextWindowTokens: 131_072,
    description: 'Enterprise dedicated service model with bundled concurrency.',
    displayName: 'DeepSeek R1 (Pro)',
    id: 'pro-deepseek-r1',
    maxOutput: 32_768,
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
    contextWindowTokens: 131_072,
    description: 'Enterprise dedicated service model with bundled concurrency.',
    displayName: 'DeepSeek V3 (Pro)',
    id: 'pro-deepseek-v3',
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
];

export const allModels = [...infiniaiChatModels];

export default allModels;
