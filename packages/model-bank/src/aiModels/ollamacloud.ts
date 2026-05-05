import { type AIChatModelCard } from '../types/aiModel';

/**
 * Ollama Cloud models from https://ollama.com/api/tags
 * Last updated: 2025-04-30
 */
const ollamaCloudModels: AIChatModelCard[] = [
  // DeepSeek V4 Series
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
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.1 is a next-generation reasoning model with improved complex reasoning and chain-of-thought, suited for tasks requiring deep analysis.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1:671b',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Gemma 3 Series
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
  // Gemma 4 Series
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Gemma 4 31B is a dense multimodal model with 256K context, vision, and thinking modes for workstation deployment.',
    displayName: 'Gemma 4 31B',
    enabled: true,
    
    id: 'gemma4:31b',
    releasedAt: '2026-04-02',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // GLM Series
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'A strong reasoning and agentic model from Z.ai with 744B total parameters (40B active), built for complex systems engineering and long-horizon tasks.',
    displayName: 'GLM-5',

    id: 'glm-5',
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
      "GLM-5.1 is Zhipu's next-generation flagship model for agentic engineering, with significantly stronger coding capabilities than its predecessor. It achieves state-of-the-art performance on SWE-Bench Pro.",
    displayName: 'GLM-5.1',
    enabled: true,
    
    id: 'glm-5.1',
    releasedAt: '2026-04-07',
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
      "GLM-4.6 is Zhipu's flagship model (355B) that fully surpasses its predecessors in advanced coding, long-text processing, reasoning, and agent capabilities.",
    displayName: 'GLM-4.6',
    id: 'glm-4.6',
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
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration.",
    displayName: 'GLM-4.7',
    id: 'glm-4.7',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Kimi K2 Series
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
    enabled: true,
    
    id: 'kimi-k2.6',
    releasedAt: '2026-03-31',
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
    description:
      'Kimi K2.5 is an open-source, native multimodal agentic model that seamlessly integrates vision and language understanding with advanced agentic capabilities, instant and thinking modes.',
    displayName: 'Kimi K2.5',
    id: 'kimi-k2.5',
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
      'K2 long thinking model supports 256k contexts, supports multi-step tool calling and thinking, and is good at solving more complex problems.',
    displayName: 'Kimi K2 Thinking',

    id: 'kimi-k2-thinking',
    releasedAt: '2025-11-06',
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
      'Kimi K2 is a large MoE LLM from Moonshot AI with 1T total parameters and 32B active per forward pass. It is optimized for agent capabilities.',
    displayName: 'Kimi K2',
    id: 'kimi-k2:1t',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Devstral
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
    },
    contextWindowTokens: 128_000,
    description:
      'Devstral Small 2 24B is a smaller variant for local deployment with strong coding capabilities.',
    displayName: 'Devstral Small 2',
    id: 'devstral-small-2:24b',
    type: 'chat',
  },
  // Cogito
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
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Gemini
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
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // MiniMax Series
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
    contextWindowTokens: 204_800,
    displayName: 'MiniMax M2.1',
    id: 'minimax-m2.1',
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
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.5 is a state-of-the-art large language model designed for real-world productivity and coding tasks.',
    displayName: 'MiniMax M2.5',
    id: 'minimax-m2.5',
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
    contextWindowTokens: 204_800,
    description:
      "MiniMax's M2.7-series model for coding, agentic workflows, and professional productivity.",
    displayName: 'MiniMax M2.7',

    id: 'minimax-m2.7',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // GPT-OSS Series
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GPT-OSS 20B is an open-source LLM from OpenAI using MXFP4 quantization, suitable for high-end consumer GPUs.',
    displayName: 'GPT-OSS 20B',
    id: 'gpt-oss:20b',
    releasedAt: '2025-08-05',
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
    contextWindowTokens: 131_072,
    description:
      "GPT-OSS 120B is OpenAI's large open-source LLM using MXFP4 quantization, requiring multi-GPU environments.",
    displayName: 'GPT-OSS 120B',
    id: 'gpt-oss:120b',
    releasedAt: '2025-08-05',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Qwen3 Series
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Alibaba's high-performance long-context model for agent and coding tasks.",
    displayName: 'Qwen3 Coder 480B',
    id: 'qwen3-coder:480b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Qwen3-Coder-Next is a coding-focused language model from Alibaba's Qwen team.",
    displayName: 'Qwen3 Coder Next',
    id: 'qwen3-coder-next',
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
    },
    contextWindowTokens: 262_144,
    description:
      'The first installment in the Qwen3-Next series with strong performance.',
    displayName: 'Qwen3 Next 80B',
    id: 'qwen3-next:80b',
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
      'Qwen3.5 is a unified vision-language foundation model with a hybrid architecture.',
    displayName: 'Qwen3.5 397B',
    id: 'qwen3.5:397b',
    settings: {
      extendParams: ['enableReasoning', 'reasoningEffort'],
    },
    type: 'chat',
  },
  // Ministral Series
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Ministral 3 3B is the smallest model in the Ministral 3 series.',
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
      'Ministral 3 8B is a powerful model in the Ministral 3 series.',
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
      'Ministral 3 14B is the largest model in the Ministral 3 series.',
    displayName: 'Ministral 3 14B',
    id: 'ministral-3:14b',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  // Mistral Large
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Mistral Large 3 is a state-of-the-art open-weight multimodal model with 675B total parameters.',
    displayName: 'Mistral Large 3',
    id: 'mistral-large-3:675b',
    releasedAt: '2025-12-02',
    type: 'chat',
  },
  // NVIDIA Nemotron Series
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
    description:
      'Nemotron 3 Nano 30B is an efficient agentic model.',
    displayName: 'Nemotron 3 Nano 30B',
    id: 'nemotron-3-nano:30b',
    type: 'chat',
  },
  // RNJ-1
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'RNJ-1 8B is a lightweight model for various tasks.',
    displayName: 'RNJ-1 8B',
    id: 'rnj-1:8b',
    type: 'chat',
  },
];

export const allModels = [...ollamaCloudModels];

export default allModels;
