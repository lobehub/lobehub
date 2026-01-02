import { AIChatModelCard } from '../types/aiModel';

const ollamaCloudModels: AIChatModelCard[] = [
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
    description: 'Gemini 3 Flash 是为速度而打造的最智能的模型，将前沿智能与卓越的搜索接地相结合。',
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
    description: 'MiniMax M2 是专为编码和代理工作流程构建的高效大型语言模型。',
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
      'GLM-4.7 是智谱最新旗舰模型，面向 Agentic Coding 场景强化了编码能力、长程任务规划与工具协同，并在多个公开基准的当期榜单中取得开源模型中的领先表现。通用能力提升，回复更简洁自然，写作更具沉浸感。在执行复杂智能体任务，在工具调用时指令遵循更强，Artifacts 与 Agentic Coding 的前端美感和长程任务完成效率进一步提升。',
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
      '智谱旗舰模型 GLM-4.6 (355B) 在高级编码、长文本处理、推理与智能体能力上全面超越前代，尤其在编程能力上对齐 Claude Sonnet 4，成为国内顶尖的 Coding 模型。',
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
];

export const allModels = [...ollamaCloudModels];

export default allModels;
