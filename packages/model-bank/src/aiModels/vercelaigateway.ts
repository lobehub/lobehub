import { AIChatModelCard, AIEmbeddingModelCard } from '../types/aiModel';

// Model list provided by Vercel AI Gateway, sorted by SOTA, large models, small models
const vercelAIGatewayChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Pro 是我们最先进的推理 Gemini 模型，能够解决复杂问题。它具有 200 万 token 的上下文窗口，支持包括文本、图像、音频、视频和 PDF 文档在内的多模态输入。',
    displayName: 'Gemini 2.5 Pro',
    enabled: true,
    id: 'google/gemini-2.5-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.1 是 Opus 4 的即插即用替代品，为实际编码和代理任务提供卓越的性能和精度。Opus 4.1 将最先进的编码性能提升到 SWE-bench Verified 的 74.5%，并以更高的严谨性和对细节的关注处理复杂的多步问题。',
    displayName: 'Claude Opus 4.1',
    id: 'anthropic/claude-opus-4.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4 是 Anthropic 迄今为止最强大的模型，也是世界上最好的编码模型，在 SWE-bench (72.5%) 和 Terminal-bench (43.2%) 上领先。它为需要专注努力和数千个步骤的长期任务提供持续性能，能够连续工作数小时——显著扩展了 AI 代理的能力。',
    displayName: 'Claude Opus 4',
    id: 'anthropic/claude-opus-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'Claude Sonnet 4 在 Sonnet 3.7 的行业领先能力基础上进行了显著改进，在编码方面表现出色，在 SWE-bench 上达到了最先进的 72.7%。该模型在性能和效率之间取得了平衡，适用于内部和外部用例，并通过增强的可控性实现对实现的更大控制。',
    displayName: 'Claude Sonnet 4',
    id: 'anthropic/claude-sonnet-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 是 OpenAI 的旗舰语言模型，在复杂推理、广泛的现实世界知识、代码密集型和多步代理任务方面表现出色。',
    displayName: 'GPT-5',
    enabled: true,
    id: 'openai/gpt-5',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'OpenAI 的 o3 是最强大的推理模型，在编码、数学、科学和视觉感知方面设立了新的最先进水平。它擅长需要多方面分析的复杂查询，在分析图像、图表和图形方面具有特殊优势。',
    displayName: 'o3',
    id: 'openai/o3',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'OpenAI 的 o1 是旗舰推理模型，专为需要深度思考的复杂问题而设计。它为复杂多步任务提供了强大的推理能力和更高的准确性。',
    displayName: 'o1',
    id: 'openai/o1',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.7 Sonnet 是第一个混合推理模型，也是 Anthropic 迄今为止最智能的模型。它在编码、内容生成、数据分析和规划任务方面提供了最先进的性能，在其前身 Claude 3.5 Sonnet 的软件工程和计算机使用能力基础上进行了构建。',
    displayName: 'Claude 3.7 Sonnet',
    id: 'anthropic/claude-3.7-sonnet',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Sonnet 在智能和速度之间达到了理想的平衡——特别是对于企业工作负载。与同类产品相比，它以更低的成本提供了强大的性能，并专为大规模 AI 部署中的高耐久性而设计。',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic/claude-3.5-sonnet',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Opus 是 Anthropic 最智能的模型，在高度复杂的任务上具有市场领先的性能。它能够以卓越的流畅度和类人理解力驾驭开放式提示和前所未见的场景。',
    displayName: 'Claude 3 Opus',
    id: 'anthropic/claude-3-opus',
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 128_000,
    description:
      'GPT-4o 来自 OpenAI，具有广泛的通用知识和领域专长，能够遵循自然语言的复杂指令并准确解决难题。它以更快、更便宜的 API 匹配 GPT-4 Turbo 的性能。',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5 mini 是一个成本优化的模型，在推理/聊天任务方面表现出色。它在速度、成本和能力之间提供了最佳平衡。',
    displayName: 'GPT-5 mini',
    id: 'openai/gpt-5-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description: 'GPT-5 nano 是一个高吞吐量模型，在简单指令或分类任务方面表现出色。',
    displayName: 'GPT-5 nano',
    id: 'openai/gpt-5-nano',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: '极其能干的通用大型语言模型，具有强大、可控的推理能力',
    displayName: 'gpt-oss-120b',
    id: 'openai/gpt-oss-120b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '一个紧凑、开源权重的语言模型，针对低延迟和资源受限环境进行了优化，包括本地和边缘部署',
    displayName: 'gpt-oss-20b',
    id: 'openai/gpt-oss-20b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3-mini 是 OpenAI 最新的小型推理模型，在 o1-mini 的相同成本和延迟目标下提供高智能。',
    displayName: 'o3-mini',
    id: 'openai/o3-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'OpenAI 的 o4-mini 提供快速、成本效益高的推理，在其尺寸上具有卓越性能，特别是在数学（AIME 基准测试中表现最佳）、编码和视觉任务方面。',
    displayName: 'o4-mini',
    id: 'openai/o4-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT 4.1 是 OpenAI 的旗舰模型，适用于复杂任务。它非常适合跨领域解决问题。',
    displayName: 'GPT-4.1',
    id: 'openai/gpt-4.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Kimi K2 是由月之暗面 AI 开发的大规模混合专家 (MoE) 语言模型，具有 1 万亿总参数和每次前向传递 320 亿激活参数。它针对代理能力进行了优化，包括高级工具使用、推理和代码合成。',
    displayName: 'Kimi K2',
    enabled: true,
    id: 'moonshotai/kimi-k2',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3-Coder-480B-A35B-Instruct 是 Qwen 最具代理性的代码模型，在代理编码、代理浏览器使用和其他基础编码任务方面具有显著性能，达到了与 Claude Sonnet 相当的结果。',
    displayName: 'Qwen3 Coder 480B A35B Instruct',
    enabled: true,
    id: 'alibaba/qwen3-coder',
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
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 系列中最新一代的大型语言模型，提供了一套全面的密集和混合专家 (MoE) 模型。基于广泛的训练构建，Qwen3 在推理、指令遵循、代理能力和多语言支持方面提供了突破性的进展。',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'alibaba/qwen-3-235b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'GLM-4.5 系列模型是专门为智能体设计的基础模型。旗舰 GLM-4.5 集成了 3550 亿总参数（320 亿活跃），统一了推理、编码和代理能力以解决复杂的应用需求。作为混合推理系统，它提供双重操作模式。',
    displayName: 'GLM-4.5',
    id: 'zai/glm-4.5',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GLM-4.5 和 GLM-4.5-Air 是我们最新的旗舰模型，专门设计为面向代理应用的基础模型。两者都利用混合专家 (MoE) 架构。GLM-4.5 的总参数数为 3550 亿，每次前向传递有 320 亿活跃参数，而 GLM-4.5-Air 采用更简化的设计，总参数数为 1060 亿，活跃参数为 120 亿。',
    displayName: 'GLM 4.5 Air',
    id: 'zai/glm-4.5-air',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 65_536,
    description:
      'GLM-4.5V 基于 GLM-4.5-Air 基础模型构建，继承了 GLM-4.1V-Thinking 的经过验证的技术，同时通过强大的 1060 亿参数 MoE 架构实现了有效的扩展。',
    displayName: 'GLM 4.5V',
    id: 'zai/glm-4.5v',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 系列中最新一代的大型语言模型，提供了一套全面的密集和混合专家 (MoE) 模型。基于广泛的训练构建，Qwen3 在推理、指令遵循、代理能力和多语言支持方面提供了突破性的进展。',
    displayName: 'Qwen3 32B',
    id: 'alibaba/qwen-3-32b',
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
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 系列中最新一代的大型语言模型，提供了一套全面的密集和混合专家 (MoE) 模型。基于广泛的训练构建，Qwen3 在推理、指令遵循、代理能力和多语言支持方面提供了突破性的进展。',
    displayName: 'Qwen3 30B A3B',
    id: 'alibaba/qwen-3-30b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 系列中最新一代的大型语言模型，提供了一套全面的密集和混合专家 (MoE) 模型。基于广泛的训练构建，Qwen3 在推理、指令遵循、代理能力和多语言支持方面提供了突破性的进展。',
    displayName: 'Qwen3 14B',
    id: 'alibaba/qwen-3-14b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Command A 是 Cohere 迄今为止性能最强的模型，在工具使用、代理、检索增强生成 (RAG) 和多语言用例方面表现出色。Command A 的上下文长度为 256K，仅需两个 GPU 即可运行，与 Command R+ 08-2024 相比吞吐量提高了 150%。',
    displayName: 'Command A',
    id: 'cohere/command-a',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek R1 模型已经进行了小版本升级，当前版本为 DeepSeek-R1-0528。在最新更新中，DeepSeek R1 通过利用增加的计算资源和在训练后引入算法优化机制，显著提高了推理深度和推理能力。该模型在数学、编程和一般逻辑等多个基准评估中表现出色，其整体性能现在正接近领先模型，如 O3 和 Gemini 2.5 Pro。',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 163_840,
    description: '具有增强推理能力的快速通用大型语言模型',
    displayName: 'DeepSeek V3 0324',
    id: 'deepseek/deepseek-v3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.77, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.77, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.0 Flash 提供下一代功能和改进的功能，包括卓越的速度、内置工具使用、多模态生成和 100 万 token 的上下文窗口。',
    displayName: 'Gemini 2.0 Flash',
    id: 'google/gemini-2.0-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.0 Flash Lite 提供下一代功能和改进的功能，包括卓越的速度、内置工具使用、多模态生成和 100 万 token 的上下文窗口。',
    displayName: 'Gemini 2.0 Flash Lite',
    id: 'google/gemini-2.0-flash-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_000_000,
    description:
      'Gemini 2.5 Flash 是一个思考模型，提供出色的全面能力。它旨在价格和性能之间取得平衡，支持多模态和 100 万 token 的上下文窗口。',
    displayName: 'Gemini 2.5 Flash',
    id: 'google/gemini-2.5-flash',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash-Lite 是一个平衡、低延迟的模型，具有可配置的思考预算和工具连接性（例如，Google Search 接地和代码执行）。它支持多模态输入，并提供 100 万 token 的上下文窗口。',
    displayName: 'Gemini 2.5 Flash Lite',
    id: 'google/gemini-2.5-flash-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'xAI 最新和最伟大的旗舰模型，在自然语言、数学和推理方面提供无与伦比的性能——完美的全能选手。',
    displayName: 'Grok 4',
    id: 'xai/grok-4',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'xAI 的轻量级模型，在响应之前进行思考。非常适合不需要深厚领域知识的简单或基于逻辑的任务。原始思维轨迹可访问。快速模型变体在更快的基础设施上提供服务，提供比标准快得多的响应时间。增加的速度以每个输出 token 更高的成本为代价。',
    displayName: 'Grok 3 Mini Fast Beta',
    id: 'xai/grok-3-mini-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
      'xAI 的轻量级模型，在响应之前进行思考。非常适合不需要深厚领域知识的简单或基于逻辑的任务。原始思维轨迹可访问。',
    displayName: 'Grok 3 Mini Beta',
    id: 'xai/grok-3-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'xAI 的旗舰模型，在企业用例方面表现出色，如数据提取、编码和文本摘要。在金融、医疗保健、法律和科学领域拥有深厚的领域知识。快速模型变体在更快的基础设施上提供服务，提供比标准快得多的响应时间。增加的速度以每个输出 token 更高的成本为代价。',
    displayName: 'Grok 3 Fast Beta',
    id: 'xai/grok-3-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
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
      'xAI 的旗舰模型，在企业用例方面表现出色，如数据提取、编码和文本摘要。在金融、医疗保健、法律和科学领域拥有深厚的领域知识。',
    displayName: 'Grok 3 Beta',
    id: 'xai/grok-3',
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
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Grok 2 视觉模型在基于视觉的任务方面表现出色，在视觉数学推理 (MathVista) 和基于文档的问答 (DocVQA) 方面提供最先进的性能。它能够处理各种视觉信息，包括文档、图表、图表、屏幕截图和照片。',
    displayName: 'Grok 2 Vision',
    id: 'xai/grok-2-vision',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Grok 2 是一个具有最先进推理能力的前沿语言模型。它在聊天、编码和推理方面具有先进能力，在 LMSYS 排行榜上优于 Claude 3.5 Sonnet 和 GPT-4-Turbo。',
    displayName: 'Grok 2',
    id: 'xai/grok-2',
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
    },
    contextWindowTokens: 128_000,
    description:
      'Meta Llama 3 70B Instruct 的更新版本，包括扩展的 128K 上下文长度、多语言和改进的推理能力。',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'meta/llama-3.1-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_000,
    description:
      'Llama 3.1 8B 支持 128K 上下文窗口，使其成为实时对话界面和数据分析的理想选择，同时与更大的模型相比提供显著的成本节约。由 Groq 使用其自定义语言处理单元 (LPU) 硬件提供服务，以提供快速高效的推理。',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta/llama-3.1-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      '指令调整的图像推理生成模型（文本 + 图像输入 / 文本输出），针对视觉识别、图像推理、标题生成和回答关于图像的一般问题进行了优化。',
    displayName: 'Llama 3.2 11B Vision Instruct',
    id: 'meta/llama-3.2-11b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: '仅文本模型，支持设备上用例，如多语言本地知识检索、摘要和重写。',
    displayName: 'Llama 3.2 1B Instruct',
    id: 'meta/llama-3.2-1b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: '仅文本模型，精心调整用于支持设备上用例，如多语言本地知识检索、摘要和重写。',
    displayName: 'Llama 3.2 3B Instruct',
    id: 'meta/llama-3.2-3b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      '指令调整的图像推理生成模型（文本 + 图像输入 / 文本输出），针对视觉识别、图像推理、标题生成和回答关于图像的一般问题进行了优化。',
    displayName: 'Llama 3.2 90B Vision Instruct',
    id: 'meta/llama-3.2-90b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '性能与效率的完美结合。该模型支持高性能对话 AI，专为内容创建、企业应用和研究而设计，提供先进的语言理解能力，包括文本摘要、分类、情感分析和代码生成。',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta/llama-3.3-70b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.72, strategy: 'fixed', unit: 'millionTokens' },
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
      'Llama 4 模型集合是原生多模态 AI 模型，支持文本和多模态体验。这些模型利用混合专家架构在文本和图像理解方面提供行业领先的性能。Llama 4 Maverick，一个 170 亿参数模型，具有 128 个专家。由 DeepInfra 提供服务。',
    displayName: 'Llama 4 Maverick 17B 128E Instruct',
    id: 'meta/llama-4-maverick',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Llama 4 模型集合是原生多模态 AI 模型，支持文本和多模态体验。这些模型利用混合专家架构在文本和图像理解方面提供行业领先的性能。Llama 4 Scout，一个 170 亿参数模型，具有 16 个专家。由 DeepInfra 提供服务。',
    displayName: 'Llama 4 Scout 17B 16E Instruct',
    id: 'meta/llama-4-scout',
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
    },
    contextWindowTokens: 256_000,
    description:
      'Mistral Codestral 25.01 是最先进的编码模型，针对低延迟、高频率用例进行了优化。精通 80 多种编程语言，它在中间填充 (FIM)、代码纠正和测试生成等任务上表现出色。',
    displayName: 'Mistral Codestral 25.01',
    id: 'mistral/codestral',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Devstral 是一个用于软件工程任务的代理大型语言模型，使其成为软件工程代理的绝佳选择。',
    displayName: 'Devstral Small',
    id: 'mistral/devstral-small',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '复杂思维，由深刻理解支持，具有您可以遵循和验证的透明推理。该模型即使在任务中途切换语言时，也能在众多语言中保持高保真推理。',
    displayName: 'Magistral Medium 2509',
    id: 'mistral/magistral-medium',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '复杂思维，由深刻理解支持，具有您可以遵循和验证的透明推理。该模型即使在任务中途切换语言时，也能在众多语言中保持高保真推理。',
    displayName: 'Magistral Small 2506',
    id: 'mistral/magistral-small',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: '一个紧凑、高效的模型，用于智能助手和本地分析等设备上任务，提供低延迟性能。',
    displayName: 'Ministral 3B',
    id: 'mistral/ministral-3b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '一个更强大的模型，具有更快、内存高效的推理，是复杂工作流程和要求苛刻的边缘应用的理想选择。',
    displayName: 'Ministral 8B',
    id: 'mistral/ministral-8b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Mistral Large 是复杂任务的理想选择，这些任务需要大型推理能力或高度专业化——如合成文本生成、代码生成、RAG 或代理。',
    displayName: 'Mistral Large',
    id: 'mistral/mistral-large',
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
    },
    contextWindowTokens: 32_000,
    description:
      'Mistral Small 是简单任务的理想选择，这些任务可以批量完成——如分类、客户支持或文本生成。它以可承受的价格点提供出色的性能。',
    displayName: 'Mistral Small',
    id: 'mistral/mistral-small',
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
    },
    contextWindowTokens: 65_536,
    description: '8x22b Instruct 模型。8x22b 是由 Mistral 提供服务的混合专家开源模型。',
    displayName: 'Mixtral MoE 8x22B Instruct',
    id: 'mistral/mixtral-8x22b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: '一个具有图像理解能力的 12B 模型，以及文本。',
    displayName: 'Pixtral 12B 2409',
    id: 'mistral/pixtral-12b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Pixtral Large 是我们多模态家族中的第二个模型，展示了前沿水平的图像理解。特别是，该模型能够理解文档、图表和自然图像，同时保持了 Mistral Large 2 的领先文本理解能力。',
    displayName: 'Pixtral Large',
    id: 'mistral/pixtral-large',
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
    },
    contextWindowTokens: 32_768,
    description: 'Mercury Coder Small 是代码生成、调试和重构任务的理想选择，具有最小延迟。',
    displayName: 'Mercury Coder Small Beta',
    id: 'inception/mercury-coder-small',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
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
      'Morph 提供了一个专门的 AI 模型，将前沿模型（如 Claude 或 GPT-4o）建议的代码更改应用到您的现有代码文件中 FAST - 4500+ tokens/秒。它充当 AI 编码工作流程中的最后一步。支持 16k 输入 tokens 和 16k 输出 tokens。',
    displayName: 'Morph V3 Fast',
    id: 'morph/morph-v3-fast',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
      'Morph 提供了一个专门的 AI 模型，将前沿模型（如 Claude 或 GPT-4o）建议的代码更改应用到您的现有代码文件中 FAST - 2500+ tokens/秒。它充当 AI 编码工作流程中的最后一步。支持 16k 输入 tokens 和 16k 输出 tokens。',
    displayName: 'Morph V3 Large',
    id: 'morph/morph-v3-large',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_385,
    description:
      'OpenAI 在 GPT-3.5 系列中最能干且最具成本效益的模型，针对聊天目的进行了优化，但在传统完成任务中也表现良好。',
    displayName: 'GPT-3.5 Turbo',
    id: 'openai/gpt-3.5-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: '与 GPT-3 时代模型类似的能力。与传统的完成端点兼容，而不是聊天完成端点。',
    displayName: 'GPT-3.5 Turbo Instruct',
    id: 'openai/gpt-3.5-turbo-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '来自 OpenAI 的 gpt-4-turbo 具有广泛的通用知识和领域专长，使其能够遵循自然语言的复杂指令并准确解决困难问题。它的知识截止日期为 2023 年 4 月，上下文窗口为 128,000 个 token。',
    displayName: 'GPT-4 Turbo',
    id: 'openai/gpt-4-turbo',
    pricing: {
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT 4.1 mini 在智能、速度和成本之间取得了平衡，使其成为许多用例的有吸引力的模型。',
    displayName: 'GPT-4.1 mini',
    id: 'openai/gpt-4.1-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 nano 是最快、最具成本效益的 GPT 4.1 模型。',
    displayName: 'GPT-4.1 nano',
    id: 'openai/gpt-4.1-nano',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini 来自 OpenAI 是他们最先进且最具成本效益的小模型。它是多模态的（接受文本或图像输入并输出文本），并且比 gpt-3.5-turbo 具有更高的智能性，但速度同样快。',
    displayName: 'GPT-4o mini',
    id: 'openai/gpt-4o-mini',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 127_000,
    description: 'Perplexity 的轻量级产品，具有搜索接地能力，比 Sonar Pro 更快、更便宜。',
    displayName: 'Sonar',
    id: 'perplexity/sonar',
    pricing: {
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
    contextWindowTokens: 200_000,
    description: 'Perplexity 的旗舰产品，具有搜索接地能力，支持高级查询和后续操作。',
    displayName: 'Sonar Pro',
    id: 'perplexity/sonar-pro',
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
    },
    contextWindowTokens: 127_000,
    description: '一个专注于推理的模型，在响应中输出思维链 (CoT)，提供具有搜索接地的详细解释。',
    displayName: 'Sonar Reasoning',
    id: 'perplexity/sonar-reasoning',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 127_000,
    description:
      '一个高级推理聚焦模型，在响应中输出思维链 (CoT)，提供具有增强搜索能力和每个请求多个搜索查询的综合解释。',
    displayName: 'Sonar Reasoning Pro',
    id: 'perplexity/sonar-reasoning-pro',
    pricing: {
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
    contextWindowTokens: 128_000,
    description:
      '访问 v0 背后的模型以生成、修复和优化现代 Web 应用，具有特定框架的推理和最新知识。',
    displayName: 'v0-1.0-md',
    id: 'vercel/v0-1.0-md',
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
    },
    contextWindowTokens: 128_000,
    description:
      '访问 v0 背后的模型以生成、修复和优化现代 Web 应用，具有特定框架的推理和最新知识。',
    displayName: 'v0-1.5-md',
    id: 'vercel/v0-1.5-md',
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
    },
    contextWindowTokens: 300_000,
    description: '一个非常低成本的多模态模型，处理图像、视频和文本输入的速度极快。',
    displayName: 'Nova Lite',
    id: 'amazon/nova-lite',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: '一个仅文本模型，以非常低的成本提供最低延迟的响应。',
    displayName: 'Nova Micro',
    id: 'amazon/nova-micro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.035, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Haiku 是我们最快模型的下一代。与 Claude 3 Haiku 的速度相似，Claude 3.5 Haiku 在每个技能集上都得到了改进，并在许多智能基准测试中超越了我们上一代最大的模型 Claude 3 Opus。',
    displayName: 'Claude 3.5 Haiku',
    id: 'anthropic/claude-3.5-haiku',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Haiku 是 Anthropic 迄今为止最快的模型，专为通常涉及较长提示的企业工作负载而设计。Haiku 可以快速分析大量文档，如季度文件、合同或法律案件，成本是其性能等级中其他模型的一半。',
    displayName: 'Claude 3 Haiku',
    id: 'anthropic/claude-3-haiku',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 300_000,
    description: '一个高度能干的多模态模型，具有准确性、速度和成本的最佳组合，适用于广泛的任务。',
    displayName: 'Nova Pro',
    id: 'amazon/nova-pro',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const vercelAIGatewayEmbeddingModels: AIEmbeddingModelCard[] = [
  {
    description:
      'Amazon Titan Text Embeddings V2 是一个轻量级、高效的多语言嵌入模型，支持 1024、512 和 256 维度。',
    displayName: 'Titan Text Embeddings V2',
    id: 'amazon/titan-embed-text-v2',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '最先进的嵌入模型，在英语、多语言和代码任务中具有出色的性能。',
    displayName: 'Gemini Embedding 001',
    id: 'google/gemini-embedding-001',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '针对代码和英语语言任务优化的英语聚焦文本嵌入模型。',
    displayName: 'Text Embedding 005',
    id: 'google/text-embedding-005',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '针对跨语言任务优化的多语言文本嵌入模型，支持多种语言。',
    displayName: 'Text Multilingual Embedding 002',
    id: 'google/text-multilingual-embedding-002',
    maxDimension: 768,
    pricing: {
      units: [{ name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '一个允许对文本、图像或混合内容进行分类或转换为嵌入的模型。',
    displayName: 'Embed v4.0',
    id: 'cohere/embed-v4.0',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '可以嵌入代码数据库和存储库以支持编码助手的代码嵌入模型。',
    displayName: 'Codestral Embed',
    id: 'mistral/codestral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: '用于语义搜索、相似性、聚类和 RAG 工作流的通用文本嵌入模型。',
    displayName: 'Mistral Embed',
    id: 'mistral/mistral-embed',
    maxDimension: 1024,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI 最能干的嵌入模型，适用于英语和非英语任务。',
    displayName: 'text-embedding-3-large',
    id: 'openai/text-embedding-3-large',
    maxDimension: 3072,
    pricing: {
      units: [{ name: 'textInput', rate: 0.13, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI 改进的、性能更高的 ada 嵌入模型版本。',
    displayName: 'text-embedding-3-small',
    id: 'openai/text-embedding-3-small',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
  {
    description: 'OpenAI 的传统文本嵌入模型。',
    displayName: 'text-embedding-ada-002',
    id: 'openai/text-embedding-ada-002',
    maxDimension: 1536,
    pricing: {
      units: [{ name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' }],
    },
    type: 'embedding',
  },
];

export const allModels = [...vercelAIGatewayChatModels, ...vercelAIGatewayEmbeddingModels];

export default allModels;
