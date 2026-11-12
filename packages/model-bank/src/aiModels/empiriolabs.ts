// Generated from the public EmpirioLabs AI model catalog:
// https://api.empiriolabs.ai/v1/models
import type { ModelParamsSchema } from '../standard-parameters';
import type { AIChatModelCard, AIImageModelCard, AIVideoModelCard } from '../types/aiModel';

// https://empiriolabs.ai/models
const empiriolabsChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'Pairs DeepSeek R1 chain-of-thought reasoning with Anthropic Claude creative and code generation behind a unified, data-controlled interface.',
    displayName: 'DeepReasoning',
    id: 'deepreasoning',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 4.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 23, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Post-trained 1017 release with stronger coding and agent results, faster task completion, shorter outputs, image input, and a 1M context window.',
    displayName: 'DeepSeek V4.1 Flash 1017',
    id: 'deepseek-v4-1-flash-1017',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Post-trained 0731 release with major gains across coding, repository work, tool use, and full-stack tasks, plus a 1M context window.',
    displayName: 'DeepSeek V4 Flash 0731',
    id: 'deepseek-v4-flash-0731',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.424, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.272, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Flagship MoE LLM with 1.6T total / 49B active parameters and native 1M context for advanced math, logical inference, and specialized coding.',
    displayName: 'DeepSeek V4 Pro',
    id: 'deepseek-v4-pro',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.65, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Official 0813 Pro release with major gains across coding, repository work, tool use, and agent tasks, plus hybrid thinking and a 1M context window.',
    displayName: 'DeepSeek V4 Pro 0813',
    id: 'deepseek-v4-pro-0813',
    maxOutput: 393_216,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.96, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Cost-efficient multi-agent conductor that assembles a right-sized expert team per task, with 1M context, image input, and web search.',
    displayName: 'Fugu Max',
    id: 'fugu-max',
    maxOutput: 131_072,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Original multi-agent conductor for hard reasoning, coding, and research, with 1M context, image input, function calling, and web search.',
    displayName: 'Fugu Ultra v1.0',
    id: 'fugu-ultra-v1-0',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 45, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Updated multi-agent conductor for hard reasoning, coding, and research, with distinct max effort, 1M context, image input, and web search.',
    displayName: 'Fugu Ultra v1.1',
    id: 'fugu-ultra-v1-1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Flagship multi-agent conductor for the hardest reasoning, coding, and research work, with 1M context, image input, and web search.',
    displayName: 'Fugu Ultra v2.0',
    id: 'fugu-ultra-v2-0',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
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
      'Open-source vision-language model with 128K context, 140+ languages, improved math/reasoning, structured outputs, and function calling.',
    displayName: 'Gemma 3 27B',
    id: 'gemma-3-27b',
    maxOutput: 16_384,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Gemma 4 26B A4B is a Google open multimodal model with 256K context, text, image, and video input, tools, and structured output.',
    displayName: 'Gemma 4 26B-A4B',
    id: 'gemma-4-26b-a4b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.29, strategy: 'fixed', unit: 'millionTokens' },
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
      'Free lightweight GLM-4.5 text model for reasoning, coding, long-form chat, and general language tasks.',
    displayName: 'GLM 4.5 Flash',
    id: 'glm-4-5-flash',
    maxOutput: 98_304,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Free multimodal GLM-4.6V model for image, video, file, and text understanding with native function calling.',
    displayName: 'GLM 4.6V Flash',
    id: 'glm-4-6v-flash',
    maxOutput: 32_768,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'High-speed GLM-4.6V vision model for image, video, file, and text understanding, with 128K context and native function calling.',
    displayName: 'GLM 4.6V FlashX',
    id: 'glm-4-6v-flashx',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Free lightweight GLM-4.7 text model for coding, reasoning, long-context writing, and general chat.',
    displayName: 'GLM 4.7 Flash',
    id: 'glm-4-7-flash',
    maxOutput: 131_072,
    pricing: {
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
      reasoning: true,
    },
    contextWindowTokens: 202_752,
    description:
      'High-speed GLM-4.7 text model for coding, reasoning, long-context writing, and chat, with 200K context, function calling, and web search.',
    displayName: 'GLM 4.7 FlashX',
    id: 'glm-4-7-flashx',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Long-context Zhipu AI reasoning model with 202K context, 128K output, tool calling, structured output, and cache support.',
    displayName: 'GLM 5.1',
    id: 'glm-5-1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.825, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.301, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Reasoning and coding model with a 1M token context, 128K output, adjustable reasoning effort, native web search, and tool calling.',
    displayName: 'GLM 5.2',
    id: 'glm-5-2',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Coding and agentic model with a 1M token context, 128K output, always-on reasoning at low, high, or max effort, native web search, and tool calling.',
    displayName: 'GLM 5.3',
    id: 'glm-5-3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Natively multimodal flash model with a 1M token context, image and video input, always-on reasoning, native web search, and tool calling.',
    displayName: 'GLM 5.3 Flash',
    id: 'glm-5-3-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.6 is a Moonshot multimodal reasoning model with 256K context, strong coding, and text, image, and video inputs.',
    displayName: 'Kimi K2.6',
    id: 'kimi-k2-6',
    maxOutput: 16_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8939, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.7131, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.7 Code is Moonshot's trillion-parameter agentic coding model with 256K context, always-on reasoning, and text, image, and video inputs.",
    displayName: 'Kimi K2.7 Code',
    id: 'kimi-k2-7-code',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.7 Code Highspeed is the faster-serving tier of Moonshot's agentic coding model, with 256K context, always-on reasoning, and image and video input.",
    displayName: 'Kimi K2.7 Code Highspeed',
    id: 'kimi-k2-7-code-highspeed',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.9, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      "Kimi K3 is Moonshot's flagship reasoning model with a 1M token context, always-on thinking, native web search, and text, image, and video inputs.",
    displayName: 'Kimi K3',
    id: 'kimi-k3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      "Moonshot's flagship reasoning model for long coding and agent work, with a 1M token context, image input, and web search.",
    displayName: 'Kimi K3.1 Pro',
    id: 'kimi-k3-1-pro',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Low-cost full-modality reasoner with native image, video, and audio understanding on a 1M context, built for high-frequency production workloads.',
    displayName: 'MiMo V2.6 Flash',
    id: 'mimo-v2-6-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Trillion-parameter flagship for agentic work, with native image, video, and audio understanding and reasoning across a 1M context.',
    displayName: 'MiMo V2.6 Pro',
    id: 'mimo-v2-6-pro',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.435, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.87, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'High-throughput build of the trillion-parameter flagship, matching its full-modality reasoning while generating output substantially faster.',
    displayName: 'MiMo V2.6 Pro UltraSpeed',
    id: 'mimo-v2-6-pro-ultraspeed',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 4.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'MiniMax M2.7 is a general-purpose reasoning chat model with interleaved thinking, function calling, and prompt caching.',
    displayName: 'MiniMax M2.7',
    id: 'minimax-m2-7',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'High-speed M2.7 variant tuned for fast inference with strong general-purpose performance with strong agentic capabilities.',
    displayName: 'MiniMax M2.7 Highspeed',
    id: 'minimax-m2-7-highspeed',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'MiniMax M3 is a multimodal reasoning model for coding, agents, and long-context analysis with text, image, and video input.',
    displayName: 'MiniMax M3',
    id: 'minimax-m3',
    maxOutput: 524_288,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.225, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Fast multimodal coding and agent model with 1M context, adjustable reasoning depth, image and video input, function calling, and built-in web search.',
    displayName: 'MiniMax M3.1 Flash',
    id: 'minimax-m3-1-flash',
    maxOutput: 524_288,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1125, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.45, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 89_587,
    description:
      '24B-parameter multimodal model for image analysis, programming, math, and multilingual tasks, tuned for efficient local inference.',
    displayName: 'Mistral Small 3.1',
    id: 'mistral-small-3-1',
    maxOutput: 32_768,
    pricing: {
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
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Hybrid model unifying Instruct, Reasoning (Magistral), and Devstral families: 40% lower completion time and 3x throughput vs Small 3.',
    displayName: 'Mistral Small 4',
    id: 'mistral-small-4',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
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
      'Meta open 30B agentic model with image understanding, 128K context, tool calling, structured output, and controllable reasoning strength.',
    displayName: 'Muse Glimmer 30B',
    id: 'muse-glimmer-30b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Meta frontier reasoning model with a 1,048,576-token context plus image, video, audio, and PDF understanding, web search, and tool calling.',
    displayName: 'Muse Spark 1.1',
    id: 'muse-spark-1-1',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      "Meta's updated frontier reasoning model with a 1,048,576-token context, image, video, audio, and PDF understanding, web search, and tool calling.",
    displayName: 'Muse Spark 1.2',
    id: 'muse-spark-1-2',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      "Meta's long-horizon agentic reasoning model with a 1,048,576-token context, image, video, and PDF understanding, web search, and tool calling.",
    displayName: 'Muse Spark 1.3',
    id: 'muse-spark-1-3',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 317_379,
    description:
      'Low-cost multimodal foundation model for text, images, and video on a 300K context (up to ~30 min video), tuned for speed and affordability.',
    displayName: 'Nova Lite 1.0',
    id: 'nova-lite-1-0',
    maxOutput: 10_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.069, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Fast, cost-effective multimodal reasoning model for text, images, documents, and video on a 1M context (long docs and ~90 min clips).',
    displayName: 'Nova Lite 2',
    id: 'nova-lite-2',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 133_003,
    description:
      'Text-only foundation model tuned for ultra-low latency and cost on 128K context. Strong for summarization, translation, and chat with 44% cache discount.',
    displayName: 'Nova Micro 1.0',
    id: 'nova-micro-1-0',
    maxOutput: 10_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 317_319,
    description:
      'Multimodal foundation model balancing accuracy, speed, and cost for text, images, and video on 300K context (up to ~30 min video).',
    displayName: 'Nova Pro 1.0',
    id: 'nova-pro-1-0',
    maxOutput: 10_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 258_048,
    description:
      'Qwen3.5 122B-A10B is a multimodal reasoning model with 256K context, efficient sparse MoE inference, and text, image, and video input.',
    displayName: 'Qwen3.5 122B-A10B',
    id: 'qwen3-5-122b-a10b',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.115, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.917, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 258_048,
    description:
      'Qwen3.5 27B is a dense multimodal reasoning model with fast responses, 256K context, and text, image, and video understanding.',
    displayName: 'Qwen3.5 27B',
    id: 'qwen3-5-27b',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.086, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.688, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 258_048,
    description:
      'Qwen3.5 35B-A3B is an efficient native vision-language model with sparse MoE routing, deep thinking, and text, image, and video input.',
    displayName: 'Qwen3.5 35B-A3B',
    id: 'qwen3-5-35b-a3b',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.057, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.459, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 258_048,
    description:
      'Qwen3.5 397B-A17B is a flagship multimodal reasoning model for language, code, agents, GUI tasks, and image and video understanding.',
    displayName: 'Qwen3.5 397B-A17B',
    id: 'qwen3-5-397b-a17b',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.172, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.032, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5 4B is a low-cost multimodal reasoning model with 256K context, image and video input, function tools, and structured output.',
    displayName: 'Qwen3.5 4B',
    id: 'qwen3-5-4b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5 9B is a compact multimodal reasoning model with 256K context, image and video input, function tools, and structured output.',
    displayName: 'Qwen3.5 9B',
    id: 'qwen3-5-9b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 995_904,
    description:
      'Vision-language model with hybrid linear-attention plus sparse MoE, 1M context, and fast multimodal text/image/video inference.',
    displayName: 'Qwen3.5 Flash',
    id: 'qwen3-5-flash',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.09, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.368, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 196_608,
    description:
      'Cost-efficient omni-modal model handling text, image, audio, and video, with up to 3 hours of audio and 1 hour of video across 90+ languages.',
    displayName: 'Qwen3.5 Omni Flash',
    id: 'qwen3-5-omni-flash',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 196_608,
    description:
      'Flagship omni-modal model for text, image, audio, and video. 3h audio, 1h video, 90+ input and 30+ output languages, 55 voice timbres.',
    displayName: 'Qwen3.5 Omni Plus',
    id: 'qwen3-5-omni-plus',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Multimodal model with hybrid architecture for efficient deep thinking and visual understanding across text, image, and video on a 1M context.',
    displayName: 'Qwen3.5 Plus',
    id: 'qwen3-5-plus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.36, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.21, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_376,
    description:
      'Qwen3.6 27B improves agentic coding, STEM reasoning, spatial vision, OCR, and text, image, and video understanding on 256K context.',
    displayName: 'Qwen3.6 27B',
    id: 'qwen3-6-27b',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.412564, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.475384, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3.6 35B A3B is a 256-expert mixture-of-experts reasoning model with 128K context, function tools, and strict structured JSON output.',
    displayName: 'Qwen3.6 35B A3B',
    id: 'qwen3-6-35b-a3b',
    maxOutput: 16_384,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.42, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Fast Qwen3.6 vision-language model for agentic coding, math reasoning, spatial understanding, OCR, and text, image, and video input.',
    displayName: 'Qwen3.6 Flash',
    id: 'qwen3-6-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Vision-language model with major upgrades over 3.5: agentic and front-end coding, multimodal recognition, OCR, and object localization.',
    displayName: 'Qwen3.6 Plus',
    id: 'qwen3-6-plus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Fast Qwen3.7 vision-language model for text, image, video, tool use, and agentic tasks, with implicit caching and a 1M token context.',
    displayName: 'Qwen3.7 Flash',
    id: 'qwen3-7-flash',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 983_616,
    description:
      'Qwen3.7 Max is a flagship text model for coding, productivity, long-running agents, deep thinking, tools, and 1M-token context.',
    displayName: 'Qwen3.7 Max',
    id: 'qwen3-7-max',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Cost-effective Qwen3.7 vision-language model for text, image, video, coding, tool use, GUI understanding, and 1M-context workflows.',
    displayName: 'Qwen3.7 Plus',
    id: 'qwen3-7-plus',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Multimodal reasoner with 256K context, image and video input, function tools, structured JSON, and thinking on by default.',
    displayName: 'Qwen3.8 27B',
    id: 'qwen3-8-27b',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.17, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Fast Qwen3.8 vision-language model for coding, agents, and visual understanding, with image and video input, five built-in tools, and a 1M token context.',
    displayName: 'Qwen3.8 Flash',
    id: 'qwen3-8-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.47, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 983_616,
    description:
      'Trillion-scale MoE flagship for coding, long-horizon agents, and professional work, with image and video understanding across a 1M-token context.',
    displayName: 'Qwen3.8 Max',
    id: 'qwen3-8-max',
    maxOutput: 131_072,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 983_616,
    description:
      'Upgraded Qwen3.8 Max snapshot with stronger coding, steadier multi-tool agent runs, and sharper chart and document vision across a 1M-token context.',
    displayName: 'Qwen3.8 Max 0902',
    id: 'qwen3-8-max-0902',
    maxOutput: 131_072,
    pricing: {
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_006_592,
    description:
      'Omni-modal reasoner that reads text, images, audio, and video and answers in text, with a 1M token context, thinking, and native web search.',
    displayName: 'Qwen3.8 Omni Flash',
    id: 'qwen3-8-omni-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.94, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_096,
    description:
      'Coding-tuned model with strong front-end results and multilingual programming support for AI coding tools and agents.',
    displayName: 'Seed 2.0 Code',
    id: 'seed-2-0-code',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_096,
    description:
      'Balanced general-purpose model for high-frequency enterprise workloads: information processing, content, search, and data analysis.',
    displayName: 'Seed 2.0 Lite',
    id: 'seed-2-0-lite',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.31, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_156,
    description:
      'Latency-focused multimodal model with four reasoning effort modes and image/video understanding for high-concurrency use.',
    displayName: 'Seed 2.0 Mini',
    id: 'seed-2-0-mini',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_096,
    description:
      'Flagship general model for complex reasoning, multimodal understanding, structured generation, and tool-augmented execution.',
    displayName: 'Seed 2.0 Pro',
    id: 'seed-2-0-pro',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.63, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.79, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 229_093,
    description:
      'Next-generation coding and agent model with engineering-grade code delivery, long-horizon autonomy, and multimodal understanding.',
    displayName: 'Seed 2.1 Turbo',
    id: 'seed-2-1-turbo',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.63, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.13, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'StepFun text reasoning model for agents, coding, tool calling, and long-context analysis.',
    displayName: 'Step 3.5 Flash',
    id: 'step-3-5-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description: 'Agent-optimized Step 3.5 Flash variant with low and high reasoning effort modes.',
    displayName: 'Step 3.5 Flash 2603',
    id: 'step-3-5-flash-2603',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'StepFun multimodal reasoning model with image and video input, tool calling, adjustable reasoning effort, and 256K context.',
    displayName: 'Step 3.7 Flash',
    id: 'step-3-7-flash',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.15, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_024_000,
    description:
      'Frontier multimodal reasoning with a 1M token context, image and video input, parallel tool calling, and strict JSON schema output.',
    displayName: 'Step 5 Preview',
    id: 'step-5-preview',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 262_144,
    description:
      'StepFun audio and text conversation model with text output and paralinguistic understanding.',
    displayName: 'StepAudio 2.5 Chat',
    id: 'stepaudio-2-5-chat',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
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
      'Audio and text conversation model that reasons before answering, with function calling and JSON output.',
    displayName: 'StepAudio 3 Chat',
    id: 'stepaudio-3-chat',
    maxOutput: 131_072,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

// Image-generation parameter schemas. EmpirioLabs serves these through the
// OpenAI-compatible /v1/images/generations endpoint, so the default image
// handler covers them with no custom runtime code. imageUrl maps to the
// upstream image-edit input, enabling image-to-image where the model supports it.
export const flux2Klein4bParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
  cfg: { default: 1, max: 8, min: 0, step: 0.5 },
  prompt: { default: '' },
  seed: { default: null },
  steps: { default: 4, max: 12, min: 1 },
};

export const gptImage2ParamsSchema: ModelParamsSchema = {
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: 'medium', enum: ['low', 'medium', 'high'] },
  size: { default: '1024x1024', enum: ['1024x1024', '1536x1024', '1024x1536'] },
};

export const grokImagineImage20ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: [
      'auto',
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '3:2',
      '2:3',
      '2:1',
      '1:2',
      '21:9',
      '5:2',
      '19.5:9',
      '9:19.5',
      '20:9',
      '9:20',
    ],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: 'auto', enum: ['auto', 'low', 'medium'] },
  resolution: { default: '1k', enum: ['1k', '2k'] },
};

export const hunyuanImage3ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '1:1',
    enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9', '9:21'],
  },
  prompt: { default: '' },
  seed: { default: null },
};

export const janusProDeepseekParamsSchema: ModelParamsSchema = {
  prompt: { default: '' },
};

export const mossImageTurboParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
  prompt: { default: '' },
  seed: { default: null },
};

export const qwenImage20ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '16:9',
    enum: ['16:9', '9:16', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: true },
  seed: { default: null },
  watermark: { default: false },
};

export const qwenImage21ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: true },
  resolution: { default: '2K', enum: ['auto', '1K', '2K'] },
  seed: { default: null },
  watermark: { default: false },
};

export const qwenImage30ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: true },
  resolution: { default: '2K', enum: ['auto', '1K', '2K'] },
  seed: { default: null },
  watermark: { default: false },
};

export const seedream40ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: '2K', enum: ['1K', '2K', '4K'] },
  watermark: { default: false },
};

export const seedream45ParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: '2K', enum: ['2K', '4K'] },
  watermark: { default: false },
};

export const seedream50FlashParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: '2K', enum: ['1K', '1.5K', '2K'] },
  watermark: { default: false },
};

export const seedream50LiteParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: '2K', enum: ['2K', '3K'] },
  watermark: { default: false },
};

export const seedream50ProParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: 'auto',
    enum: ['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  quality: { default: '2K', enum: ['1K', '1.5K', '2K'] },
  watermark: { default: false },
};

export const wan21ImageParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
  prompt: { default: '' },
  promptExtend: { default: true },
  seed: { default: null },
  watermark: { default: false },
};

export const wan22ImageParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
  prompt: { default: '' },
  promptExtend: { default: true },
  seed: { default: null },
  watermark: { default: false },
};

export const wan25ImageParamsSchema: ModelParamsSchema = {
  aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
  imageUrl: { default: null },
  prompt: { default: '' },
  promptExtend: { default: true },
  seed: { default: null },
  watermark: { default: false },
};

export const wan27ImageParamsSchema: ModelParamsSchema = {
  aspectRatio: {
    default: '16:9',
    enum: ['16:9', '1:1', '9:16', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5'],
  },
  imageUrl: { default: null },
  prompt: { default: '' },
  resolution: { default: '2K', enum: ['1K', '2K', '4K'] },
  seed: { default: null },
  watermark: { default: false },
};

const empiriolabsImageModels: AIImageModelCard[] = [
  {
    description:
      'Apache-licensed 4B FLUX.2 Klein image generation and editing model with text-to-image, reference-image editing, and creative workflow support.',
    displayName: 'FLUX.2 Klein 4B',
    enabled: true,
    id: 'flux-2-klein-4b',
    organization: 'Black Forest Labs',
    parameters: flux2Klein4bParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.0085, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      "OpenAI's flagship image model with strong prompt fidelity, crisp text rendering, and instruction-based editing across up to 16 reference images.",
    displayName: 'GPT Image 2',
    enabled: true,
    id: 'gpt-image-2',
    organization: 'OpenAI',
    parameters: gptImage2ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.012, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Text-to-image plus multi-reference editing with up to five source images, automatic or pinned quality tiers, and 1K or 2K output resolution.',
    displayName: 'Grok Imagine Image 2.0',
    enabled: true,
    id: 'grok-imagine-image-2-0',
    organization: 'xAI',
    parameters: grokImagineImage20ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.048, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Open-source text-to-image model on a multimodal Mixture-of-Experts architecture with photorealistic detail and strong multilingual text rendering.',
    displayName: 'Hunyuan Image 3',
    enabled: true,
    id: 'hunyuan-image-3',
    organization: 'Tencent',
    parameters: hunyuanImage3ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.13, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Autoregressive framework on the Janus Pro 7B model that unifies multimodal understanding and image generation in one architecture.',
    displayName: 'Janus-Pro DeepSeek',
    enabled: true,
    id: 'janus-pro-deepseek',
    organization: 'DeepSeek',
    parameters: janusProDeepseekParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'OpenMOSS text-to-image model that renders accurate English and Chinese text in signs, posters, and layouts, with aspect ratio and seed controls.',
    displayName: 'MOSS-Image Turbo',
    enabled: true,
    id: 'moss-image-turbo',
    organization: 'OpenMOSS',
    parameters: mossImageTurboParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.015, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Unified image generation and editing model with class-leading complex Chinese/English text rendering, realistic textures, and multi-image fusion.',
    displayName: 'Qwen Image 2.0',
    enabled: true,
    id: 'qwen-image-2-0',
    organization: 'Alibaba',
    parameters: qwenImage20ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Image generation and editing with Pro and Turbo variants, up to ten reference images, transparent PNG output, and custom sizes up to 2560x2560.',
    displayName: 'Qwen Image 2.1',
    enabled: true,
    id: 'qwen-image-2-1',
    organization: 'Alibaba',
    parameters: qwenImage21ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Qwen image generation and editing with Base and Pro variants, multilingual typography, multi-image references, and controllable 1K or 2K output.',
    displayName: 'Qwen Image 3.0',
    enabled: true,
    id: 'qwen-image-3-0',
    organization: 'Alibaba',
    parameters: qwenImage30ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Unified image generation and editing with up to 14 reference images, batch sets of up to 15, and 1K to 4K output at one flat per-image price.',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'seedream-4-0',
    organization: 'ByteDance',
    parameters: seedream40ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.06, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'High-fidelity image generation and editing with up to 14 reference images, strong text rendering, and 2K or 4K output at one flat price.',
    displayName: 'Seedream 4.5',
    enabled: true,
    id: 'seedream-4-5',
    organization: 'ByteDance',
    parameters: seedream45ParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.08, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Fast Seedream image model that splits one image into editable layers, edits by coordinate or sketch marker, and fuses up to 10 references.',
    displayName: 'Seedream 5.0 Flash',
    enabled: true,
    id: 'seedream-5-0-flash',
    organization: 'ByteDance',
    parameters: seedream50FlashParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Unified multimodal image model that reasons through prompts before rendering, producing high-resolution and consistent edits and brand visuals.',
    displayName: 'Seedream 5.0 Lite',
    enabled: true,
    id: 'seedream-5-0-lite',
    organization: 'ByteDance',
    parameters: seedream50LiteParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.035, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Premium Seedream image model that splits one image into editable layers, edits by coordinate or sketch marker, and fuses up to 10 references.',
    displayName: 'Seedream 5.0 Pro',
    enabled: true,
    id: 'seedream-5-0-pro',
    organization: 'ByteDance',
    parameters: seedream50ProParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      "Alibaba's Wan 2.1 text-to-image model with turbo and plus tiers and up to 1440x1440 output at low per-image pricing.",
    displayName: 'Wan2.1 Image',
    enabled: true,
    id: 'wan2-1-image',
    organization: 'Alibaba',
    parameters: wan21ImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.025, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      "Alibaba's Wan 2.2 text-to-image model with plus and flash tiers and up to 1440x1440 output at low per-image pricing.",
    displayName: 'Wan2.2 Image',
    enabled: true,
    id: 'wan2-2-image',
    organization: 'Alibaba',
    parameters: wan22ImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.05, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      "Alibaba's Wan 2.5 image model with text-to-image and multi-reference editing of up to 3 images at about 1.7 megapixels.",
    displayName: 'Wan2.5 Image',
    enabled: true,
    id: 'wan2-5-image',
    organization: 'Alibaba',
    parameters: wan25ImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
  {
    description:
      'Image generation and editing companion model: text-to-image, bounding-box edits, and cohesive image sets, with up to 4K output on Pro.',
    displayName: 'Wan2.7 Image',
    enabled: true,
    id: 'wan2-7-image',
    organization: 'Alibaba',
    parameters: wan27ImageParamsSchema,
    pricing: {
      units: [{ name: 'imageGeneration', rate: 0.03, strategy: 'fixed', unit: 'image' }],
    },
    type: 'image',
  },
];

// Video models are served through the async /v1/videos/generations endpoint
// (submit returns a job id, the result is polled at /v1/jobs/{id}). The
// EmpirioLabs runtime provider supplies createVideo + handlePollVideoStatus.
// Each card exposes only the parameters that map to a field the API reads,
// and the runtime forwards them as the camelCase keys the provider translates.
const empiriolabsVideoModels: AIVideoModelCard[] = [
  {
    description:
      'Text-to-video, image-to-video, and reference-to-video generation with up to seven reference images for consistent characters, up to 15 seconds at 1080p.',
    displayName: 'Grok Imagine Video 1.5',
    enabled: true,
    id: 'grok-imagine-video-1-5',
    organization: 'xAI',
    parameters: {
      aspectRatio: { default: '1:1', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] },
      duration: { default: 10, max: 15, min: 1 },
      imageUrl: { default: null },
      imageUrls: { default: [], maxCount: 4 },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.168, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Video model offering Text-to-Video, Image-to-Video, Reference-to-Video, and Video Edit modes with high-fidelity, motion-smooth output.',
    displayName: 'HappyHorse 1.0',
    enabled: true,
    id: 'happyhorse-1-0',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 3 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.24, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Text, image, and reference-to-video in one model. Cinematic motion, character consistency across up to 9 references, and synchronized native audio.',
    displayName: 'HappyHorse 1.1',
    enabled: true,
    id: 'happyhorse-1-1',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 3 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.14, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      '8.3B-parameter video model with native 720p output (upscalable to 1080p), strong motion coherence, and bilingual prompt understanding up to 10s.',
    displayName: 'Hunyuan Video 1.5',
    enabled: true,
    id: 'hunyuan-video-1-5',
    organization: 'Tencent',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 10, min: 1 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '480p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.061, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Text-to-video and image-to-video with synchronized native audio, at 720p or 1080p for 3 to 15 seconds, with aspect ratio and prompt control.',
    displayName: 'Kling 3.0 Turbo',
    enabled: true,
    id: 'kling-3-0-turbo',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1'] },
      duration: { default: 5, max: 15, min: 3 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['720p', '1080p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.18, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Makes 3 to 30 second clips at 720p or 1080p with native audio from text, first, middle and last frames, reference images and videos, or a video to edit.',
    displayName: 'Kling 4.0',
    enabled: true,
    id: 'kling-4-0',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '21:9'] },
      duration: { default: 5, max: 30, min: 3 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      imageUrls: { default: [], maxCount: 4 },
      prompt: { default: '' },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.235, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'The faster, lower-cost Kling 4.0: 3 to 20 second clips at 720p with native audio from text, a first frame, reference images and videos, or a video to edit.',
    displayName: 'Kling 4.0 Flash',
    enabled: true,
    id: 'kling-4-0-flash',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '21:9'] },
      duration: { default: 5, max: 20, min: 3 },
      imageUrl: { default: null },
      imageUrls: { default: [], maxCount: 4 },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['720p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.094, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Video model in Standard or Pro modes with Text-to-Video, Image-to-Video, Reference-to-Video, editing, native sound, and multi-scene transitions.',
    displayName: 'Kling O3',
    enabled: true,
    id: 'kling-o3',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '1:1', '9:16'] },
      duration: { default: 5, max: 15, min: 3 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      imageUrls: { default: [], maxCount: 4 },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.168, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      "Kuaishou's Kling 3.0 video generator with text-to-video, first and last frame image-to-video, native audio, and 720p, 1080p, or 4K output.",
    displayName: 'Kling V3',
    enabled: true,
    id: 'kling-v3',
    organization: 'Kuaishou',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1'] },
      duration: { default: 5, max: 15, min: 3 },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.168, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Generates 4 to 15 second clips at up to 2K with native stereo audio, following text, image, video, and audio references in one request.',
    displayName: 'MiniMax H3',
    enabled: true,
    id: 'minimax-h3',
    organization: 'MiniMax',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
      duration: { default: 6, max: 15, min: 4 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '768p', enum: ['768p', '2k'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.18, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Fast 4 to 15 second 768p clips with native stereo audio, from text, a first and last frame, or image, video, and audio references in one request.',
    displayName: 'MiniMax H3 Highspeed',
    enabled: true,
    id: 'minimax-h3-highspeed',
    organization: 'MiniMax',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
      duration: { default: 6, max: 15, min: 4 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '768p', enum: ['768p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.06, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Lower-cost 4 to 15 second clips at 480p or 768p with native stereo audio, from text, a first and last frame, or image, video, and audio references.',
    displayName: 'MiniMax H3 Lite',
    enabled: true,
    id: 'minimax-h3-lite',
    organization: 'MiniMax',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
      },
      duration: { default: 6, max: 15, min: 4 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '768p', enum: ['480p', '768p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.04, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Open-source 32B MoE foundation model that generates synchronized video and audio in one inference step with precise dual-tower lip-sync.',
    displayName: 'MOSS Video and Audio',
    enabled: true,
    id: 'moss-video-and-audio',
    organization: 'OpenMOSS',
    parameters: {
      aspectRatio: { default: 'landscape', enum: ['landscape', 'portrait'] },
      duration: { default: 4, max: 8, min: 2 },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '360p', enum: ['360p', '720p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.12, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Turns a single portrait into a talking avatar video, driven by an uploaded audio track or by text spoken with a built-in voice.',
    displayName: 'Pixverse Avatar',
    enabled: true,
    id: 'pixverse-avatar',
    organization: 'PixVerse',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.076667, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Cinema-grade video model for action and effects work, from text, images, first and last frames, or references, with native synchronized audio.',
    displayName: 'Pixverse C1',
    enabled: true,
    id: 'pixverse-c1',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
      },
      duration: { default: 5, max: 15, min: 1 },
      endImageUrl: { default: null },
      generateAudio: { default: false },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.051111, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Six video transformations in one model: prompt editing, restyling, subject swap, motion transfer, upscaling, and generated sound effects.',
    displayName: 'Pixverse Edit',
    enabled: true,
    id: 'pixverse-edit',
    organization: 'PixVerse',
    parameters: {
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '540p', enum: ['360p', '540p', '720p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.051111, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Aligns mouth movement in an existing video to an uploaded audio track or to text spoken by one of fourteen built-in voices.',
    displayName: 'Pixverse Lip Sync',
    enabled: true,
    id: 'pixverse-lipsync',
    organization: 'PixVerse',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.020444, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Cinematic video generation in Text-to-Video, Image-to-Video, and Transition modes with high detail, fluid motion, and lifelike animations.',
    displayName: 'Pixverse v5',
    enabled: true,
    id: 'pixverse-v5',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '4:3', '1:1', '3:4', '9:16'] },
      duration: { default: 5, enum: [5, 8], max: 8, min: 5 },
      endImageUrl: { default: null },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.306667, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'Generates videos from text or 1-2 frame image prompts up to 1080p, multiple aspect ratios, 5-10s durations, with optional synchronized audio.',
    displayName: 'Pixverse v5.6',
    enabled: true,
    id: 'pixverse-v5-6',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '4:3', '1:1', '3:4', '9:16'] },
      duration: { default: 5, enum: [5, 8, 10], max: 10, min: 5 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '1080p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.75, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'Generates video from text, images, first and last frames, or up to seven references, with native audio, multi-shot cuts, and clip extension.',
    displayName: 'Pixverse v6',
    enabled: true,
    id: 'pixverse-v6',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
      },
      duration: { default: 5, max: 15, min: 1 },
      endImageUrl: { default: null },
      generateAudio: { default: false },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.046, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Text- and image-to-video up to 15 seconds at 1080p, with 5,000-character prompts, shot-by-shot direction, and native synchronized audio.',
    displayName: 'PixVerse V6 Max',
    enabled: true,
    id: 'pixverse-v6-max',
    organization: 'PixVerse',
    parameters: {
      aspectRatio: {
        default: '16:9',
        enum: ['16:9', '4:3', '1:1', '3:4', '9:16', '2:3', '3:2', '21:9'],
      },
      duration: { default: 5, max: 15, min: 1 },
      generateAudio: { default: false },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['360p', '540p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.056222, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Speed-optimized 2.0 video variant for cinematic clips with native audio sync, camera control, and stable motion at lower cost per render.',
    displayName: 'Seedance 2.0 Fast',
    enabled: true,
    id: 'seedance-2-0-fast',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 15, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.26, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'The fastest, most affordable Seedance 2.0 tier for short cinematic clips with native audio, camera control, and image or video inputs at 480p and 720p.',
    displayName: 'Seedance 2.0 Mini',
    enabled: true,
    id: 'seedance-2-0-mini',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 15, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Multimodal video model for cinematic output from text, image, audio, or video inputs, with stable motion and consistent characters.',
    displayName: 'Seedance 2.0 Pro',
    enabled: true,
    id: 'seedance-2-0-pro',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 15, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '480p', enum: ['480p', '720p', '1080p', '4k'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.139, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Long-form video model for coherent clips up to 30 seconds, with up to 50 reference images, videos, and audio clips, native audio, editing, and extension.',
    displayName: 'Seedance 2.5',
    enabled: true,
    id: 'seedance-2-5',
    organization: 'ByteDance',
    parameters: {
      aspectRatio: {
        default: 'adaptive',
        enum: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
      },
      duration: { default: 5, max: 30, min: 4 },
      endImageUrl: { default: null },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      resolution: { default: '720p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.462, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Reads a video and writes a timed creative brief, with a prompt per scene for music and sound design, ready to drive a later generation.',
    displayName: 'Sonilo Video Analysis',
    enabled: true,
    id: 'sonilo-video-analysis',
    organization: 'sonilo',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.0004, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Returns your own video with a generated soundtrack, frame-synced effects, or both mixed in, keeping the original picture untouched.',
    displayName: 'Sonilo Video to Video',
    enabled: true,
    id: 'sonilo-video-to-video',
    organization: 'sonilo',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.018, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Dubs a video into 24 languages with lip-sync matched voices, returning one finished video per language plus optional subtitle tracks.',
    displayName: 'Sonilo Video Translation',
    enabled: true,
    id: 'sonilo-video-translation',
    organization: 'sonilo',
    parameters: {
      prompt: { default: '' },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0, strategy: 'fixed', unit: 'video' }],
    },
    type: 'video',
  },
  {
    description:
      'Stable Video Infinity 2.0 Pro on WAN 2.2: extends still images into theoretically infinite-length video while keeping consistent character IDs.',
    displayName: 'SVI 2.0 Pro',
    enabled: true,
    id: 'svi-2-0-pro',
    organization: 'VITA-EPFL',
    parameters: {
      duration: { default: 18, max: 121.5, min: 18 },
      prompt: { default: '' },
      size: { default: '832x480', enum: ['832x480', '480x832', '720x1280', '1280x720'] },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.057, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      "Alibaba's Wan 2.1 video model with turbo and plus tiers for text-to-video, image-to-video, and first and last frame clips at 480p or 720p.",
    displayName: 'Wan 2.1',
    enabled: true,
    id: 'wan-2-1',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 5, min: 5 },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '720p', enum: ['480p', '720p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.036, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      "Alibaba's Wan 2.2 video family with standard and flash tiers, first and last frame interpolation, and 480p to 1080p output at low cost.",
    displayName: 'Wan 2.2',
    enabled: true,
    id: 'wan-2-2',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.1, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      "Alibaba's Wan 2.5 video model with text-to-video and image-to-video, native audio, optional custom audio tracks, and 480p to 1080p output.",
    displayName: 'Wan 2.5',
    enabled: true,
    id: 'wan-2-5',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 10, min: 5 },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Multimodal video generation model for cinematic, multi-shot stories with native audio-visual sync (lip-sync, dialogue, music, SFX).',
    displayName: 'Wan 2.6',
    enabled: true,
    id: 'wan-2-6',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 5 },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'Multimodal video model supporting T2V, I2V, video editing, and reference-to-video, with high-fidelity output from text, image, or video inputs.',
    displayName: 'Wan 2.7',
    enabled: true,
    id: 'wan-2-7',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: '16:9', enum: ['16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 15, min: 2 },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.15, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
  {
    description:
      'All-in-one video generation up to 30 seconds with native audio, omni-modal references (images, video, audio, files, web links), and a fast Prime tier.',
    displayName: 'Wan 3.0',
    enabled: true,
    id: 'wan-3-0',
    organization: 'Alibaba',
    parameters: {
      aspectRatio: { default: 'adaptive', enum: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4'] },
      duration: { default: 5, max: 30, min: 2 },
      generateAudio: { default: true },
      imageUrl: { default: null },
      prompt: { default: '' },
      promptExtend: { default: true },
      resolution: { default: '1080p', enum: ['480p', '720p', '1080p'] },
      seed: { default: null },
    },
    pricing: {
      units: [{ name: 'videoGeneration', rate: 0.28, strategy: 'fixed', unit: 'second' }],
    },
    type: 'video',
  },
];

export const allModels = [
  ...empiriolabsChatModels,
  ...empiriolabsImageModels,
  ...empiriolabsVideoModels,
];

export default allModels;
