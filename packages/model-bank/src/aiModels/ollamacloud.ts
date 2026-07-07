import { type AIChatModelCard } from '../types/aiModel';

const ollamaCloudModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'GLM-5.2 is Z.ai’s flagship model for the era of long-horizon tasks.',
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
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
      "Kimi K2.7 Code is Moonshot AI's coding-focused agentic model built upon Kimi K2.6, with substantial improvements on real-world long-horizon coding tasks and roughly 30% lower thinking-token usage.",
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 512_000,
    description: 'MiniMax M3: Coding & Agentic Frontier. 1M context window. Native Multimodality.',
    displayName: 'MiniMax M3',
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
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
      'Kimi K2.6 is an open-source, native multimodal agentic model that advances practical capabilities in long-horizon coding, coding-driven design, proactive autonomous execution, and swarm-based task orchestration.',
    displayName: 'Kimi K2.6',
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
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
      'GLM-5.1 is our next-generation flagship model for agentic engineering, with significantly stronger coding capabilities than its predecessor. It achieves state-of-the-art performance on SWE-Bench Pro and leads GLM-5 by a wide margin.',
    displayName: 'GLM-5.1',
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
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
    displayName: 'Gemma 4 31B',
    family: 'gemma',
    generation: 'gemma-4',
    id: 'gemma4:31b',
    knowledgeCutoff: '2025-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2.7 is an efficient large language model built specifically for coding and agent workflows.',
    displayName: 'MiniMax M2.7',
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimax-m2.7',
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
      'Qwen3.5 is a unified vision–language foundation model with a hybrid architecture (Mixture-of-Experts + linear attention), offering strong multimodal reasoning, coding, and long-context capabilities with a 256K context window.',
    displayName: 'Qwen3.5 397B A17B',
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5:397b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Qwen3-Coder-Next is a coding-focused language model from Alibaba's Qwen team, optimized for agentic coding workflows and local development. Built on top of Qwen3-Next-80B-A3B-Base with hybrid attention and MoE architecture, trained on large-scale executable tasks with environment interaction and reinforcement learning.",
    displayName: 'Qwen3 Coder Next',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder-next',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.5 is a state-of-the-art large language model designed for real-world productivity and coding tasks.',
    displayName: 'MiniMax M2.5',
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'minimax-m2.5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'A strong reasoning and agentic model from Z.ai with 744B total parameters (40B active), built for complex systems engineering and long-horizon tasks.',
    displayName: 'GLM-5',
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5',
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
      'Kimi K2.5 is an open-source, native multimodal agentic model that seamlessly integrates vision and language understanding with advanced agentic capabilities, instant and thinking modes, as well as conversational and agentic paradigms.',
    displayName: 'Kimi K2.5',
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'kimi-k2.5',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Devstral 2 123B excels at using tools to explore codebases, edit multiple files, and support software engineering agents.',
    displayName: 'Devstral 2',
    family: 'devstral',
    id: 'devstral-2:123b',
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
      'Gemini 3 Flash is the smartest model built for speed, combining cutting-edge intelligence with excellent search grounding.',
    displayName: 'Gemini 3 Flash Preview',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'gemini-3-flash-preview',
    knowledgeCutoff: '2025-01',
    releasedAt: '2025-12-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    displayName: 'MiniMax M2.1',
    family: 'minimax',
    generation: 'minimax-m2.1',
    id: 'minimax-m2.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration. It achieves leading performance among open-source models on multiple public benchmarks. General capabilities are improved with more concise and natural responses and more immersive writing. For complex agent tasks, instruction following during tool calls is stronger, and the frontend aesthetics and long-term task completion efficiency of Artifacts and Agentic Coding are further enhanced.",
    displayName: 'GLM-4.7',
    family: 'glm',
    generation: 'glm-4.7',
    id: 'glm-4.7',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.1 is a next-generation reasoning model with improved complex reasoning and chain-of-thought, suited for tasks requiring deep analysis.',
    displayName: 'DeepSeek V3.1',
    family: 'deepseek',
    generation: 'deepseek-v3.1',
    id: 'deepseek-v3.1:671b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GPT-OSS 20B is an open-source LLM from OpenAI using MXFP4 quantization, suitable for high-end consumer GPUs or Apple Silicon Macs. It performs well in dialogue generation, coding, and reasoning tasks, supporting function calling and tool use.',
    displayName: 'GPT-OSS 20B',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss:20b',
    knowledgeCutoff: '2024-06',
    releasedAt: '2025-08-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GPT-OSS 120B is OpenAI’s large open-source LLM using MXFP4 quantization and positioned as a flagship model. It requires multi-GPU or high-end workstation environments and delivers excellent performance in complex reasoning, code generation, and multilingual processing, with advanced function calling and tool integration.',
    displayName: 'GPT-OSS 120B',
    family: 'gpt-oss',
    generation: 'gpt-oss',
    id: 'gpt-oss:120b',
    knowledgeCutoff: '2024-06',
    releasedAt: '2025-08-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description: "Alibaba's high-performance long-context model for agent and coding tasks.",
    displayName: 'Qwen3 Coder 480B',
    family: 'qwen',
    generation: 'qwen3',
    id: 'qwen3-coder:480b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 3B is the smallest and most efficient model in the Ministral 3 series, offering strong language and vision capabilities in a compact package. Designed for edge deployment, it delivers high performance on various hardware including local setups.',
    displayName: 'Ministral 3 3B',
    family: 'ministral',
    id: 'ministral-3:3b',
    knowledgeCutoff: '2023-10',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 8B is a powerful and efficient model in the Ministral 3 series, delivering top-tier text and vision capabilities. Built for edge deployment, it delivers high performance on various hardware including local setups.',
    displayName: 'Ministral 3 8B',
    family: 'ministral',
    id: 'ministral-3:8b',
    knowledgeCutoff: '2023-10',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 14B is the largest model in the Ministral 3 series, delivering state-of-the-art performance comparable to the larger Mistral Small 3.2 24B counterpart. Optimized for local deployment, it delivers high performance on various hardware including local setups.',
    displayName: 'Ministral 3 14B',
    family: 'ministral',
    id: 'ministral-3:14b',
    knowledgeCutoff: '2023-10',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Mistral Large 3 is a state-of-the-art open-weight general-purpose multimodal model with a refined Mixture of Experts architecture. It has 41B active parameters and 675B total parameters.',
    displayName: 'Mistral Large 3',
    family: 'mistral',
    id: 'mistral-large-3:675b',
    knowledgeCutoff: '2023-10',
    releasedAt: '2025-12-02',
    type: 'chat',
  },

  // === Added models (not in upstream canary) ===
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek-V4-Flash is a preview of the DeepSeek-V4 series, a Mixture-of-Experts model with 284B total parameters and 13B activated, built for efficient reasoning across a 1M-token context window.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,

    id: 'deepseek-v4-flash',
    releasedAt: '2026-04-24',
    settings: {
      extendParamOptions: {
        enableReasoning: {
          defaultValue: true,
          includeBudget: false,
        },
      },
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
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
      'DeepSeek-V4-Pro is a frontier Mixture-of-Experts model with a 1M-token context window and three reasoning modes.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,

    id: 'deepseek-v4-pro',
    releasedAt: '2026-04-24',
    settings: {
      extendParamOptions: {
        enableReasoning: {
          defaultValue: true,
          includeBudget: false,
        },
      },
      extendParams: ['enableReasoning', 'deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.2 is a next-generation reasoning model with improved complex reasoning and chain-of-thought.',
    displayName: 'DeepSeek V3.2',

    id: 'deepseek-v3.2',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
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
      'Gemma 3 4B is a lightweight multimodal model from Google, optimized for efficient vision and language tasks.',
    displayName: 'Gemma 3 4B',

    id: 'gemma3:4b',
    releasedAt: '2025-03-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Gemma 3 12B is a multimodal model from Google with strong vision and language capabilities.',
    displayName: 'Gemma 3 12B',

    id: 'gemma3:12b',
    releasedAt: '2025-03-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Gemma 3 27B is the largest Gemma 3 model, delivering frontier-level multimodal performance.',
    displayName: 'Gemma 3 27B',

    id: 'gemma3:27b',
    releasedAt: '2025-03-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Devstral Small 2 24B is a smaller variant for local deployment with strong coding capabilities.',
    displayName: 'Devstral Small 2',
    id: 'devstral-small-2:24b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description: 'The first installment in the Qwen3-Next series with strong performance.',
    displayName: 'Qwen3 Next 80B',
    id: 'qwen3-next:80b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'NVIDIA Nemotron 3 Super is a 120B open MoE model for complex multi-agent applications.',
    displayName: 'Nemotron 3 Super',
    id: 'nemotron-3-super',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Nemotron 3 Nano 30B is an efficient agentic model.',
    displayName: 'Nemotron 3 Nano 30B',
    id: 'nemotron-3-nano:30b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'RNJ-1 8B is a lightweight model for various tasks.',
    displayName: 'RNJ-1 8B',
    id: 'rnj-1:8b',
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
      "Kimi K2.7 Code is Moonshot AI's coding-focused agentic model built upon Kimi K2.6, with substantial improvements on real-world long-horizon coding tasks and roughly 30% lower thinking-token usage.",
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 524_288,
    description:
      'MiniMax M3 achieves top-tier performance on coding and agentic benchmarks, with autonomous task decomposition, tool invocation, and multi-step reasoning capabilities. Powered by MiniMax Sparse Attention (MSA) architecture, it supports up to 1M tokens context window with a guaranteed minimum of 512K tokens.',
    displayName: 'MiniMax M3',
    enabled: true,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
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
      "GLM-5.2 is Z.ai's flagship model for the era of long-horizon tasks, with a truly usable 1M-token context window, stronger coding capabilities with multiple thinking effort levels, and an MIT open-source license.",
    displayName: 'GLM-5.2',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
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
      'NVIDIA Nemotron 3 Ultra is a 550 billion parameter (55B active) open model from NVIDIA built for long-running, agentic workflows with fast and affordable performance across hundreds of tool calls.',
    displayName: 'Nemotron 3 Ultra',
    enabled: true,
    family: 'nemotron',
    generation: 'nemotron-3',
    id: 'nemotron-3-ultra',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
];

export const allModels = [...ollamaCloudModels];

export default allModels;
