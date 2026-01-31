import { AIChatModelCard } from '../types/aiModel';

const ollamaCloudModels: AIChatModelCard[] = [
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
    enabled: true,
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
    id: 'devstral-2:123b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'Cogito v2.1 671B is a US open-source LLM free for commercial use, with performance rivaling top models, higher token reasoning efficiency, a 128k long context, and strong overall capability.',
    displayName: 'Cogito v2.1 671B',
    id: 'cogito-2.1:671b',
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
      'Gemini 3 Pro is Google’s most intelligent model, with state-of-the-art reasoning, multimodal understanding, and strong agent and vibe-coding capabilities.',
    displayName: 'Gemini 3 Pro Preview',
    id: 'gemini-3-pro-preview',
    releasedAt: '2025-11-20',
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
    id: 'gemini-3-flash-preview',
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
    enabled: true,
    id: 'minimax-m2.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      'MiniMax M2 is an efficient large language model built specifically for coding and agent workflows.',
    displayName: 'MiniMax M2',
    id: 'minimax-m2',
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
    enabled: true,
    id: 'glm-4.7',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Zhipu's flagship model GLM-4.6 (355B) fully surpasses its predecessors in advanced coding, long-text processing, reasoning, and agent capabilities. It particularly aligns with Claude Sonnet 4 in programming ability, becoming China's top Coding model.",
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
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
    id: 'gpt-oss:20b',
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
    id: 'gpt-oss:120b',
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
      'Kimi K2 is a large MoE LLM from Moonshot AI with 1T total parameters and 32B active per forward pass. It is optimized for agent capabilities including advanced tool use, reasoning, and code synthesis.',
    displayName: 'Kimi K2',
    id: 'kimi-k2:1t',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description: "Alibaba's high-performance long-context model for agent and coding tasks.",
    displayName: 'Qwen3 Coder 480B',
    id: 'qwen3-coder:480b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3 VL 235B Instruct',
    id: 'qwen3-vl:235b-instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    displayName: 'Qwen3 VL 235B',
    id: 'qwen3-vl:235b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 3B 是 Ministral 3 系列中最小的、最有效的模型，提供强大的语言和视觉能力在一个紧凑的包中。专为边缘部署设计，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 3B',
    id: 'ministral-3:3b',
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
      'Ministral 3 8B 是 Ministral 3 系列中的强大且有效的模型，提供一流的文本和视觉能力。专为边缘部署构建，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 8B',
    id: 'ministral-3:8b',
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
      'Ministral 3 14B 是 Ministral 3 系列中最大的模型，提供最先进的性能和与其更大的 Mistral Small 3.2 24B 对应模型相当的性能。针对本地部署优化，它在包括本地设置在内的各种硬件上提供高性能。',
    displayName: 'Ministral 3 14B',
    id: 'ministral-3:14b',
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
      'Mistral Large 3 是一款最先进的开放权重通用多模态模型，采用精细的混合专家架构。它具有41B活跃参数和675B总参数。',
    displayName: 'Mistral Large 3',
    id: 'mistral-large-3:675b',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
];

export const allModels = [...ollamaCloudModels];

export default allModels;
