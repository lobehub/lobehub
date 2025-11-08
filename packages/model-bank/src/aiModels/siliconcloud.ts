import { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://siliconflow.cn/zh-cn/models
const siliconcloudChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-VL-32B-Instruct 是阿里巴巴通义千问团队推出的视觉语言模型，在多个视觉语言基准测试中取得了领先的 SOTA 性能。该模型支持百万像素级别的高分辨率图像输入，并具备强大的通用视觉理解、多语言 OCR、细粒度视觉定位和视觉对话能力。作为 Qwen3 系列中的视觉语言模型，它能够处理复杂的多模态任务，支持工具调用和前缀续写等高级功能。',
    displayName: 'Qwen3 VL 32B Instruct',
    id: 'Qwen/Qwen3-VL-32B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-21',
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
      'Qwen3-VL-32B-Thinking 是阿里巴巴通义千问团队推出的视觉语言模型中一个为复杂视觉推理任务特别优化的版本。该模型内置了"思考模式"，使其在回答问题前能够生成详细的中间推理步骤，从而显著增强其在需要多步逻辑、规划和复杂推理的任务上的表现。该模型支持百万像素级别的高分辨率图像输入，具备强大的通用视觉理解、多语言 OCR、细粒度视觉定位和视觉对话能力，并支持工具调用和前缀续写等功能。',
    displayName: 'Qwen3 VL 32B Thinking',
    id: 'Qwen/Qwen3-VL-32B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-21',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'DeepSeek-OCR 是由深度求索（DeepSeek AI）推出的一个视觉语言模型，专注于光学字符识别（OCR）与"上下文光学压缩"。该模型旨在探索从图像中压缩上下文信息的边界，能够高效处理文档并将其转换为如 Markdown 等结构化文本格式。它能够准确识别图像中的文字内容，特别适用于文档数字化、文字提取和结构化处理等应用场景。',
    displayName: 'DeepSeek OCR',
    id: 'deepseek-ai/DeepSeek-OCR',
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
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Qwen3-Omni-30B-A3B-Instruct 是阿里巴巴通义千问团队最新 Qwen3 系列中的一员。它是一个拥有 300 亿总参数和 30 亿激活参数的混合专家（MoE）模型，在保持强大性能的同时有效降低了推理成本。该模型在高质量、多来源、多语言的数据上进行训练，具备强大的通用能力，支持全模态输入处理，包括文本、图像、音频和视频，能够理解和生成跨模态的内容。',
    displayName: 'Qwen3 Omni 30B A3B Instruct',
    id: 'Qwen/Qwen3-Omni-30B-A3B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-22',
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
      'Qwen3-Omni-30B-A3B-Thinking 是 Qwen3-Omni 全模态模型中的核心"思考者"（Thinker）组件。它专门负责处理包括文本、音频、图像和视频在内的多模态输入，并执行复杂的思维链推理。作为推理的大脑，该模型将所有输入统一到通用的表征空间中，实现跨模态的深度理解和复杂推理能力。该模型基于混合专家（MoE）架构，拥有 300 亿总参数和 30 亿激活参数，能够在保持强大推理能力的同时优化计算效率。',
    displayName: 'Qwen3 Omni 30B A3B Thinking',
    id: 'Qwen/Qwen3-Omni-30B-A3B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-22',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Qwen3-Omni-30B-A3B-Captioner 是阿里巴巴通义千问团队 Qwen3 系列中的一款视觉语言模型（VLM）。它专门用于生成高质量、详细且准确的图像描述。该模型基于 300 亿总参数的混合专家（MoE）架构，能够深入理解图像内容并将其转化为自然流畅的文字描述。它在图像细节捕捉、场景理解、物体识别和关系推理等方面表现卓越，特别适合需要精确图像理解和描述生成的应用场景。',
    displayName: 'Qwen3 Omni 30B A3B Captioner',
    id: 'Qwen/Qwen3-Omni-30B-A3B-Captioner',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-22',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      '混元翻译模型（Hunyuan Translation Model）由一个翻译模型 Hunyuan-MT-7B 和一个集成模型 Hunyuan-MT-Chimera 组成。Hunyuan-MT-7B 是一个拥有 70 亿参数的轻量级翻译模型，用于将源文本翻译成目标语言。该模型支持 33 种语言以及 5 种中国少数民族语言的互译。在 WMT25 国际机器翻译竞赛中，Hunyuan-MT-7B 在其参与的 31 个语言类别中获得了 30 个第一名，展现了其卓越的翻译能力。针对翻译场景，腾讯混元提出了一个从预训练到监督微调、再到翻译强化和集成强化的完整训练范式，使其在同等规模的模型中达到了业界领先的性能。该模型计算效率高、易于部署，适合多种应用场景。',
    displayName: 'Hunyuan MT 7B',
    id: 'tencent/Hunyuan-MT-7B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ling-1T 是 "灵 2.0" 系列的首款旗舰级 non-thinking 模型，拥有 1 万亿总参数和每 token 约 500 亿个活动参数。基于灵 2.0 架构构建，Ling-1T 旨在突破高效推理和可扩展认知的极限。Ling-1T-base 在超过 20 万亿个高质量、推理密集的 token 上进行训练，针对大型知识密集型任务与长文档理解进行了优化，具备出色的工具调用和上下文记忆能力。',
    displayName: 'Ling 1T',
    id: 'inclusionAI/Ling-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ring-1T 是一款由百灵（Bailing）团队发布的万亿参数规模的开源思想模型。它基于 Ling 2.0 架构和 Ling-1T-base 基础模型训练，总参数量达 1 万亿，激活参数量为 500 亿，并支持高达 128K 的上下文窗口。该模型通过大规模可验证奖励强化学习进行优化。',
    displayName: 'Ring-1T',
    id: 'inclusionAI/Ring-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-14',
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
      'Ling-1T 是"灵 2.0"系列的首款旗舰级 non-thinking 模型，拥有 1 万亿总参数和每 token 约 500 亿个活动参数。基于灵 2.0 架构构建，Ling-1T 旨在突破高效推理和可扩展认知的极限。Ling-1T-base 在超过 20 万亿个高质量、推理密集的 token 上进行训练。',
    displayName: 'Ling-1T',
    id: 'inclusionAI/Ling-1T',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 198_000,
    description:
      '与 GLM-4.5 相比，GLM-4.6 带来了多项关键改进。其上下文窗口从 128K 扩展到 200K tokens，使模型能够处理更复杂的智能体任务。模型在代码基准测试中取得了更高的分数，并在 Claude Code、Cline、Roo Code 和 Kilo Code 等应用中展现了更强的真实世界性能，包括在生成视觉效果精致的前端页面方面有所改进。GLM-4.6 在推理性能上表现出明显提升，并支持在推理过程中使用工具，从而带来了更强的综合能力。它在工具使用和基于搜索的智能体方面表现更强，并且能更有效地集成到智能体框架中。在写作方面，该模型在风格和可读性上更符合人类偏好，并在角色扮演场景中表现得更自然。',
    displayName: 'GLM-4.6',
    id: 'zai-org/GLM-4.6',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
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
    contextWindowTokens: 256_000,
    description:
      'Qwen3-Next-80B-A3B-Thinking 是由阿里巴巴通义千问团队发布的、专为复杂推理任务设计的下一代基础模型。它基于创新的 Qwen3-Next 架构，该架构融合了混合注意力机制（Gated DeltaNet 与 Gated Attention）和高稀疏度混合专家（MoE）结构，旨在实现极致的训练与推理效率。作为一个总参数达 800 亿的稀疏模型，它在推理时仅激活约 30 亿参数，大幅降低了计算成本，在处理超过 32K tokens 的长上下文任务时，吞吐量比 Qwen3-32B 模型高出 10 倍以上。此“Thinking”版本专为执行数学证明、代码综合、逻辑分析和规划等高难度多步任务而优化，并默认以结构化的“思维链”形式输出推理过程。在性能上，它不仅超越了 Qwen3-32B-Thinking 等成本更高的模型，还在多个基准测试中优于 Gemini-2.5-Flash-Thinking。',
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'Qwen/Qwen3-Next-80B-A3B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-10',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-Next-80B-A3B-Instruct 是由阿里巴巴通义千问团队发布的下一代基础模型。它基于全新的 Qwen3-Next 架构，旨在实现极致的训练和推理效率。该模型采用了创新的混合注意力机制（Gated DeltaNet 和 Gated Attention）、高稀疏度混合专家（MoE）结构以及多项训练稳定性优化。作为一个拥有 800 亿总参数的稀疏模型，它在推理时仅需激活约 30 亿参数，从而大幅降低了计算成本，并在处理超过 32K tokens 的长上下文任务时，推理吞吐量比 Qwen3-32B 模型高出 10 倍以上。此模型为指令微调版本，专为通用任务设计，不支持思维链（Thinking）模式。在性能上，它与通义千问的旗舰模型 Qwen3-235B 在部分基准测试中表现相当，尤其在超长上下文任务中展现出明显优势。',
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'Qwen/Qwen3-Next-80B-A3B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-10',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-VL-30B-A3B-Instruct 是 Qwen3-VL 系列的指令微调版本，具有强大的视觉-语言理解与生成能力，原生支持 256K 上下文长度，适合多模态对话与图像条件生成任务。',
    displayName: 'Qwen3 VL 30B A3B Instruct',
    id: 'Qwen/Qwen3-VL-30B-A3B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 256_000,
    description:
      'Qwen3-VL-30B-A3B-Thinking 是 Qwen3-VL 的推理增强版本（Thinking），在多模态推理、图像到代码和复杂视觉理解任务上进行了优化，支持 256K 上下文并具备更强的链式思考能力。',
    displayName: 'Qwen3 VL 30B A3B Thinking',
    id: 'Qwen/Qwen3-VL-30B-A3B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3-VL-235B-A22B-Instruct 是 Qwen3-VL 系列的大型指令微调模型，基于混合专家（MoE）架构，拥有卓越的多模态理解与生成能力，原生支持 256K 上下文，适用于高并发生产级多模态服务。',
    displayName: 'Qwen3 VL 235B A22B Instruct',
    id: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
    pricing: {
      currency: 'CNY',
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
    contextWindowTokens: 256_000,
    description:
      'Qwen3-VL-235B-A22B-Thinking 是 Qwen3-VL 系列中的旗舰思考版本，针对复杂多模态推理、长上下文推理与智能体交互进行了专项优化，适合需要深度思考与视觉推理的企业级场景。',
    displayName: 'Qwen3 VL 235B A22B Thinking',
    id: 'Qwen/Qwen3-VL-235B-A22B-Thinking',
    pricing: {
      currency: 'CNY',
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
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.2-Exp 是 DeepSeek 发布的实验性 V3.2 版本，作为迈向下一代架构的中间探索。它在 V3.1-Terminus 的基础上引入了 DeepSeek 稀疏注意力（DeepSeek Sparse Attention，DSA）机制以提升长上下文训练与推理效率，针对工具调用、长文档理解与多步推理进行了专项优化。V3.2-Exp 为研究与产品化之间的桥梁，适合希望在高上下文预算场景中探索更高推理效率的用户。',
    displayName: 'DeepSeek V3.2 Exp',
    id: 'deepseek-ai/DeepSeek-V3.2-Exp',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-29',
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
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.2-Exp 是 DeepSeek 发布的实验性 V3.2 版本，作为迈向下一代架构的中间探索。它在 V3.1-Terminus 的基础上引入了 DeepSeek 稀疏注意力（DeepSeek Sparse Attention，DSA）机制以提升长上下文训练与推理效率，针对工具调用、长文档理解与多步推理进行了专项优化。V3.2-Exp 为研究与产品化之间的桥梁，适合希望在高上下文预算场景中探索更高推理效率的用户。',
    displayName: 'DeepSeek V3.2 Exp (Pro)',
    id: 'Pro/deepseek-ai/DeepSeek-V3.2-Exp',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-29',
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
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1-Terminus 是由深度求索（DeepSeek）发布的 V3.1 模型的更新版本，定位为混合智能体大语言模型。此次更新在保持模型原有能力的基础上，专注于修复用户反馈的问题并提升稳定性。它显著改善了语言一致性，减少了中英文混用和异常字符的出现。模型集成了“思考模式”（Thinking Mode）和“非思考模式”（Non-thinking Mode），用户可通过聊天模板灵活切换以适应不同任务。作为一个重要的优化，V3.1-Terminus 增强了代码智能体（Code Agent）和搜索智能体（Search Agent）的性能，使其在工具调用和执行多步复杂任务方面更加可靠。',
    displayName: 'DeepSeek V3.1 Terminus',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3.1-Terminus',
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
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1-Terminus 是由深度求索（DeepSeek）发布的 V3.1 模型的更新版本，定位为混合智能体大语言模型。此次更新在保持模型原有能力的基础上，专注于修复用户反馈的问题并提升稳定性。它显著改善了语言一致性，减少了中英文混用和异常字符的出现。模型集成了“思考模式”（Thinking Mode）和“非思考模式”（Non-thinking Mode），用户可通过聊天模板灵活切换以适应不同任务。作为一个重要的优化，V3.1-Terminus 增强了代码智能体（Code Agent）和搜索智能体（Search Agent）的性能，使其在工具调用和执行多步复杂任务方面更加可靠。',
    displayName: 'DeepSeek V3.1 Terminus (Pro)',
    id: 'Pro/deepseek-ai/DeepSeek-V3.1-Terminus',
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
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-VL-8B-Instruct 是 Qwen3 系列的视觉语言模型，基于 Qwen3-8B-Instruct 开发并在大量图文数据上训练，擅长通用视觉理解、以视觉为中心的对话以及图像中的多语言文本识别。适用于视觉问答、图像描述、多模态指令跟随与工具调用场景。',
    displayName: 'Qwen3 VL 8B Instruct',
    id: 'Qwen/Qwen3-VL-8B-Instruct',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Qwen3-VL-8B-Thinking 是 Qwen3 系列的视觉思考版本，针对复杂多步推理任务优化，默认在回答前生成逐步思考（thinking chain）以提高推理准确性。适合需要深度推理的视觉问答、审阅图像内容并给出详细分析的场景。',
    displayName: 'Qwen3 VL 8B Thinking',
    id: 'Qwen/Qwen3-VL-8B-Thinking',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    settings: {
      extendParams: ['reasoningBudgetToken'],
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
      'Ring-flash-2.0 是一个基于 Ling-flash-2.0-base 深度优化的高性能思考模型。它采用混合专家（MoE）架构，总参数量为 100B，但在每次推理中仅激活 6.1B 参数。该模型通过独创的 icepop 算法，解决了 MoE 大模型在强化学习（RL）训练中的不稳定性难题，使其复杂推理能力在长周期训练中得以持续提升。Ring-flash-2.0 在数学竞赛、代码生成和逻辑推理等多个高难度基准测试中取得了显著突破，其性能不仅超越了 40B 参数规模以下的顶尖稠密模型，还能媲美更大规模的开源 MoE 模型及闭源的高性能思考模型。尽管该模型专注于复杂推理，它在创意写作等任务上也表现出色。此外，得益于其高效的架构设计，Ring-flash-2.0 在提供强大性能的同时，也实现了高速推理，显著降低了思考模型在高并发场景下的部署成本。',
    displayName: 'Ring Flash 2.0',
    id: 'inclusionAI/Ring-flash-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-19',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ling-flash-2.0 是由蚂蚁集团百灵团队发布的 Ling 2.0 架构系列的第三款模型。它是一款混合专家（MoE）模型，总参数规模达到 1000 亿，但每个 token 仅激活 61 亿参数（非词向量激活 48 亿）。 作为一个轻量级配置的模型，Ling-flash-2.0 在多个权威评测中展现出媲美甚至超越 400 亿级别稠密（Dense）模型及更大规模 MoE 模型的性能。该模型旨在通过极致的架构设计与训练策略，在“大模型等于大参数”的共识下探索高效能的路径。',
    displayName: 'Ling Flash 2.0',
    id: 'inclusionAI/Ling-flash-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Ling-mini-2.0 是一款基于 MoE 架构的小尺寸高性能大语言模型。它拥有 16B 总参数，但每个 token 仅激活 1.4B（non-embedding 789M），从而实现了极高的生成速度。得益于高效的 MoE 设计与大规模高质量训练数据，尽管激活参数仅为 1.4B，Ling-mini-2.0 依然在下游任务中展现出可媲美 10B 以下 dense LLM 及更大规模 MoE 模型的顶尖性能。',
    displayName: 'Ling Mini 2.0',
    id: 'inclusionAI/Ling-mini-2.0',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-09',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Seed-OSS 是由字节跳动 Seed 团队开发的一系列开源大型语言模型，专为强大的长上下文处理、推理、智能体（agent）和通用能力而设计。该系列中的 Seed-OSS-36B-Instruct 是一个拥有 360 亿参数的指令微调模型，它原生支持超长上下文长度，使其能够一次性处理海量文档或复杂的代码库。该模型在推理、代码生成和智能体任务（如工具使用）方面进行了特别优化，同时保持了平衡且出色的通用能力。此模型的一大特色是“思考预算”（Thinking Budget）功能，允许用户根据需要灵活调整推理长度，从而在实际应用中有效提升推理效率。',
    displayName: 'Seed OSS 36B Instruct',
    id: 'ByteDance-Seed/Seed-OSS-36B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-20',
    settings: {
      extendParams: ['reasoningBudgetToken'],
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
      'Step3 是由阶跃星辰（StepFun）发布的前沿多模态推理模型，它基于拥有 321B 总参数和 38B 激活参数的专家混合（MoE）架构构建。该模型采用端到端设计，旨在最小化解码成本，同时在视觉语言推理方面提供顶级性能。通过多矩阵分解注意力（MFA）和注意力-FFN 解耦（AFD）的协同设计，Step3 在旗舰级和低端加速器上都能保持卓越的效率。在预训练阶段，Step3 处理了超过 20T 的文本 token 和 4T 的图文混合 token，覆盖十多种语言。该模型在数学、代码及多模态等多个基准测试中均达到了开源模型的领先水平。',
    displayName: 'Step 3',
    id: 'stepfun-ai/step3',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-31',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-Coder-480B-A35B-Instruct 是由阿里巴巴发布的、迄今为止最具代理（Agentic）能力的代码模型。它是一个拥有 4800 亿总参数和 350 亿激活参数的混合专家（MoE）模型，在效率和性能之间取得了平衡。该模型原生支持 256K（约 26 万） tokens 的上下文长度，并可通过 YaRN 等外推方法扩展至 100 万 tokens，使其能够处理大规模代码库和复杂的编程任务。Qwen3-Coder 专为代理式编码工作流设计，不仅能生成代码，还能与开发工具和环境自主交互，以解决复杂的编程问题。在多个编码和代理任务的基准测试中，该模型在开源模型中取得了顶尖水平，其性能可与 Claude Sonnet 4 等领先模型相媲美。',
    displayName: 'Qwen3 Coder 480B A35B Instruct',
    id: 'Qwen/Qwen3-Coder-480B-A35B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-Coder-30B-A3B-Instruct 是由阿里巴巴通义千问团队开发的 Qwen3 系列中的代码模型。作为一个经过精简优化的模型，它在保持高性能和高效率的同时，专注于提升代码处理能力。该模型在代理式编程（Agentic Coding）、自动化浏览器操作和工具调用等复杂任务上，于开源模型中表现出显著的性能优势。它原生支持 256K tokens 的长上下文，并可扩展至 1M tokens，从而能够更好地进行代码库级别的理解和处理。此外，该模型为 Qwen Code、CLINE 等平台提供了强大的代理编码支持，并设计了专门的函数调用格式。',
    displayName: 'Qwen3 Coder 30B A3B Instruct',
    id: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-31',
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
      'GLM-4.5V 是由智谱 AI（Zhipu AI）发布的最新一代视觉语言模型（VLM）该模型基于拥有 106B 总参数和 12B 激活参数的旗舰文本模型 GLM-4.5-Air 构建，采用了混合专家（MoE）架构，旨在以更低的推理成本实现卓越性能 GLM-4.5V 在技术上延续了 GLM-4.1V-Thinking 的路线，并引入了三维旋转位置编码（3D-RoPE）等创新，显著增强了对三维空间关系的感知与推理能力。通过在预训练、监督微调和强化学习阶段的优化，该模型具备了处理图像、视频、长文档等多种视觉内容的能力，在 41 个公开的多模态基准测试中达到了同级别开源模型的顶尖水平此外，模型还新增了“思考模式”开关，允许用户在快速响应和深度推理之间灵活选择，以平衡效率与效果。',
    displayName: 'GLM-4.5V',
    id: 'zai-org/GLM-4.5V',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-11',
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
      'GLM-4.5 是一款专为智能体应用打造的基础模型，使用了混合专家（Mixture-of-Experts）架构。在工具调用、网页浏览、软件工程、前端编程领域进行了深度优化，支持无缝接入 Claude Code、Roo Code 等代码智能体中使用。GLM-4.5 采用混合推理模式，可以适应复杂推理和日常使用等多种应用场景。',
    displayName: 'GLM-4.5',
    id: 'zai-org/GLM-4.5',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-28',
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
      'GLM-4.5-Air 是一款专为智能体应用打造的基础模型，使用了混合专家（Mixture-of-Experts）架构。在工具调用、网页浏览、软件工程、前端编程领域进行了深度优化，支持无缝接入 Claude Code、Roo Code 等代码智能体中使用。GLM-4.5 采用混合推理模式，可以适应复杂推理和日常使用等多种应用场景。',
    displayName: 'GLM-4.5-Air',
    id: 'zai-org/GLM-4.5-Air',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Pangu-Pro-MoE 72B-A16B 是一款 720 亿参数、激活 160 亿参的稀疏大语言模型，它基于分组混合专家（MoGE）架构，它在专家选择阶段对专家进行分组，并约束 token 在每个组内激活等量专家，从而实现专家负载均衡，显著提升模型在昇腾平台的部署效率。',
    displayName: 'Pangu Pro MoE 72B A16B',
    id: 'ascend-tribe/pangu-pro-moe',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'ERNIE-4.5-300B-A47B 是由百度公司开发的一款基于混合专家（MoE）架构的大语言模型。该模型总参数量为 3000 亿，但在推理时每个 token 仅激活 470 亿参数，从而在保证强大性能的同时兼顾了计算效率。作为 ERNIE 4.5 系列的核心模型之一，在文本理解、生成、推理和编程等任务上展现出卓越的能力。该模型采用了一种创新的多模态异构 MoE 预训练方法，通过文本与视觉模态的联合训练，有效提升了模型的综合能力，尤其在指令遵循和世界知识记忆方面效果突出。',
    displayName: 'ERNIE 4.5 300B A47B',
    id: 'baidu/ERNIE-4.5-300B-A47B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-30',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2-Instruct-0905 是 Kimi K2 最新、最强大的版本。它是一款顶尖的混合专家（MoE）语言模型，拥有 1 万亿的总参数和 320 亿的激活参数。该模型的主要特性包括：增强的智能体编码智能，在公开基准测试和真实世界的编码智能体任务中表现出显著的性能提升；改进的前端编码体验，在前端编程的美观性和实用性方面均有进步。',
    displayName: 'Kimi K2 0905',
    id: 'moonshotai/Kimi-K2-Instruct-0905',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2-Instruct-0905 是 Kimi K2 最新、最强大的版本。它是一款顶尖的混合专家（MoE）语言模型，拥有 1 万亿的总参数和 320 亿的激活参数。该模型的主要特性包括：增强的智能体编码智能，在公开基准测试和真实世界的编码智能体任务中表现出显著的性能提升；改进的前端编码体验，在前端编程的美观性和实用性方面均有进步。',
    displayName: 'Kimi K2 0905 (Pro)',
    id: 'Pro/moonshotai/Kimi-K2-Instruct-0905',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-05',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Kimi-Dev-72B 是一款开源代码大模型，经过大规模强化学习优化，能输出稳健、可直接投产的补丁。该模型在 SWE-bench Verified 上取得 60.4 % 的新高分，刷新了开源模型在缺陷修复、代码评审等自动化软件工程任务上的纪录。',
    displayName: 'Kimi Dev 72B',
    id: 'moonshotai/Kimi-Dev-72B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-17',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Hunyuan-A13B-Instruct 参数量800 亿，激活 130 亿参数即可对标更大模型，支持“快思考/慢思考”混合推理；长文理解稳定；经 BFCL-v3 与 τ-Bench 验证，Agent 能力领先；结合 GQA 与多量化格式，实现高效推理。',
    displayName: 'Hunyuan A13B Instruct',
    id: 'tencent/Hunyuan-A13B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-27',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'MiniMax-M1 是开源权重的大规模混合注意力推理模型，拥有 4560 亿参数，每个 Token 可激活约 459 亿参数。模型原生支持 100 万 Token 的超长上下文，并通过闪电注意力机制，在 10 万 Token 的生成任务中相比 DeepSeek R1 节省 75% 的浮点运算量。同时，MiniMax-M1 采用 MoE（混合专家）架构，结合 CISPO 算法与混合注意力设计的高效强化学习训练，在长输入推理与真实软件工程场景中实现了业界领先的性能。',
    displayName: 'MiniMax M1 80K',
    id: 'MiniMaxAI/MiniMax-M1-80k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-06-16',
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'QwenLong-L1-32B 是首个使用强化学习训练的长上下文大型推理模型（LRM），专门针对长文本推理任务进行优化。该模型通过渐进式上下文扩展的强化学习框架，实现了从短上下文到长上下文的稳定迁移。在七个长上下文文档问答基准测试中，QwenLong-L1-32B 超越了 OpenAI-o3-mini 和 Qwen3-235B-A22B 等旗舰模型，性能可媲美 Claude-3.7-Sonnet-Thinking。该模型特别擅长数学推理、逻辑推理和多跳推理等复杂任务。',
    displayName: 'QwenLong L1 32B',
    id: 'Tongyi-Zhiwen/QwenLong-L1-32B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-26',
    settings: {
      extendParams: ['reasoningBudgetToken'],
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
      'Qwen3-235B-A22B-Thinking-2507 是由阿里巴巴通义千问团队开发的 Qwen3 系列大型语言模型中的一员，专注于高难度的复杂推理任务。该模型基于混合专家（MoE）架构，总参数量达 2350 亿，而在处理每个 token 时仅激活约 220 亿参数，从而在保持强大性能的同时提高了计算效率。作为一个专门的“思考”模型，它在逻辑推理、数学、科学、编程和学术基准测试等需要人类专业知识的任务上表现显著提升，达到了开源思考模型中的顶尖水平。此外，模型还增强了通用能力，如指令遵循、工具使用和文本生成，并原生支持 256K 的长上下文理解能力，非常适合用于需要深度推理和处理长文档的场景。',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    id: 'Qwen/Qwen3-235B-A22B-Thinking-2507',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Qwen3-235B-A22B-Instruct-2507 是由阿里云通义千问团队开发的 Qwen3 系列中的一款旗舰级混合专家（MoE）大语言模型。该模型拥有 2350 亿总参数，每次推理激活 220 亿参数。它是作为 Qwen3-235B-A22B 非思考模式的更新版本发布的，专注于在指令遵循、逻辑推理、文本理解、数学、科学、编程及工具使用等通用能力上实现显著提升。此外，模型增强了对多语言长尾知识的覆盖，并能更好地对齐用户在主观和开放性任务上的偏好，以生成更有帮助和更高质量的文本。',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'Qwen/Qwen3-235B-A22B-Instruct-2507',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-21',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-30B-A3B-Thinking-2507 是由阿里巴巴通义千问团队发布的 Qwen3 系列的最新思考模型。作为一个拥有 305 亿总参数和 33 亿激活参数的混合专家（MoE）模型，它专注于提升复杂任务的处理能力。该模型在逻辑推理、数学、科学、编程和需要人类专业知识的学术基准测试上表现出显著的性能提升。同时，它在指令遵循、工具使用、文本生成和与人类偏好对齐等通用能力方面也得到了显著增强。模型原生支持 256K 的长上下文理解能力，并可扩展至 100 万 tokens。此版本专为“思考模式”设计，旨在通过详尽的逐步推理来解决高度复杂的任务，其 Agent 智能体能力也表现出色。',
    displayName: 'Qwen3 30B A3B Thinking 2507',
    id: 'Qwen/Qwen3-30B-A3B-Thinking-2507',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 262_144,
    description:
      'Qwen3-30B-A3B-Instruct-2507 是 Qwen3-30B-A3B 非思考模式的更新版本。这是一个拥有 305 亿总参数和 33 亿激活参数的混合专家（MoE）模型。该模型在多个方面进行了关键增强，包括显著提升了指令遵循、逻辑推理、文本理解、数学、科学、编码和工具使用等通用能力。同时，它在多语言的长尾知识覆盖范围上取得了实质性进展，并能更好地与用户在主观和开放式任务中的偏好对齐，从而能够生成更有帮助的回复和更高质量的文本。此外，该模型的长文本理解能力也增强到了 256K。此模型仅支持非思考模式，其输出中不会生成 `<think></think>` 标签。',
    displayName: 'Qwen3 30B A3B Instruct 2507',
    id: 'Qwen/Qwen3-30B-A3B-Instruct-2507',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3是一款能力大幅提升的新一代通义千问大模型，在推理、通用、Agent和多语言等多个核心能力上均达到业界领先水平，并支持思考模式切换。',
    displayName: 'Qwen3 235B A22B',
    id: 'Qwen/Qwen3-235B-A22B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3是一款能力大幅提升的新一代通义千问大模型，在推理、通用、Agent和多语言等多个核心能力上均达到业界领先水平，并支持思考模式切换。',
    displayName: 'Qwen3 32B',
    id: 'Qwen/Qwen3-32B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3是一款能力大幅提升的新一代通义千问大模型，在推理、通用、Agent和多语言等多个核心能力上均达到业界领先水平，并支持思考模式切换。',
    displayName: 'Qwen3 30B A3B',
    id: 'Qwen/Qwen3-30B-A3B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3是一款能力大幅提升的新一代通义千问大模型，在推理、通用、Agent和多语言等多个核心能力上均达到业界领先水平，并支持思考模式切换。',
    displayName: 'Qwen3 14B',
    id: 'Qwen/Qwen3-14B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3是一款能力大幅提升的新一代通义千问大模型，在推理、通用、Agent和多语言等多个核心能力上均达到业界领先水平，并支持思考模式切换。',
    displayName: 'Qwen3 8B (Free)',
    id: 'Qwen/Qwen3-8B',
    organization: 'Qwen',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
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
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-9B-Thinking 是由智谱 AI 和清华大学 KEG 实验室联合发布的一款开源视觉语言模型（VLM），专为处理复杂的多模态认知任务而设计。该模型基于 GLM-4-9B-0414 基础模型，通过引入“思维链”（Chain-of-Thought）推理机制和采用强化学习策略，显著提升了其跨模态的推理能力和稳定性。',
    displayName: 'GLM-4.1V 9B Thinking (Free)',
    id: 'THUDM/GLM-4.1V-9B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-02',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.1V-9B-Thinking 是由智谱 AI 和清华大学 KEG 实验室联合发布的一款开源视觉语言模型（VLM），专为处理复杂的多模态认知任务而设计。该模型基于 GLM-4-9B-0414 基础模型，通过引入“思维链”（Chain-of-Thought）推理机制和采用强化学习策略，显著提升了其跨模态的推理能力和稳定性。',
    displayName: 'GLM-4.1V 9B Thinking (Pro)',
    id: 'Pro/THUDM/GLM-4.1V-9B-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-07-02',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-Z1-Rumination-32B-0414 是一个具有沉思能力的深度推理模型（与 OpenAI 的 Deep Research 对标）。与典型的深度思考模型不同，沉思模型采用更长时间的深度思考来解决更开放和复杂的问题。',
    displayName: 'GLM-Z1-Rumination 32B 0414',
    id: 'THUDM/GLM-Z1-Rumination-32B-0414',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    settings: {
      extendParams: ['reasoningBudgetToken'],
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
      'GLM-Z1-32B-0414 是一个具有深度思考能力的推理模型。该模型基于 GLM-4-32B-0414 通过冷启动和扩展强化学习开发，并在数学、代码和逻辑任务上进行了进一步训练。与基础模型相比，GLM-Z1-32B-0414 显著提升了数学能力和解决复杂任务的能力。',
    displayName: 'GLM-Z1 32B 0414',
    id: 'THUDM/GLM-Z1-32B-0414',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-Z1-9B-0414 是 GLM 系列的小型模型，仅有 90 亿参数，但保持了开源传统的同时展现出惊人的能力。尽管规模较小，该模型在数学推理和通用任务上仍表现出色，其总体性能在同等规模的开源模型中已处于领先水平。',
    displayName: 'GLM-Z1 9B 0414 (Free)',
    id: 'THUDM/GLM-Z1-9B-0414',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'GLM-4-32B-0414 是 GLM 系列的新一代开源模型，拥有 320 亿参数。该模型性能可与 OpenAI 的 GPT 系列和 DeepSeek 的 V3/R1 系列相媲美。',
    displayName: 'GLM-4 32B 0414',
    id: 'THUDM/GLM-4-32B-0414',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.89, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.89, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'GLM-4-9B-0414 是 GLM 系列的小型模型，拥有 90 亿参数。该模型继承了 GLM-4-32B 系列的技术特点，但提供了更轻量级的部署选择。尽管规模较小，GLM-4-9B-0414 仍在代码生成、网页设计、SVG 图形生成和基于搜索的写作等任务上展现出色能力。',
    displayName: 'GLM-4 9B 0414 (Free)',
    id: 'THUDM/GLM-4-9B-0414',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4-9B-Chat 是智谱 AI 推出的 GLM-4 系列预训练模型中的开源版本。该模型在语义、数学、推理、代码和知识等多个方面表现出色。除了支持多轮对话外，GLM-4-9B-Chat 还具备网页浏览、代码执行、自定义工具调用（Function Call）和长文本推理等高级功能。模型支持 26 种语言，包括中文、英文、日语、韩语和德语等。在多项基准测试中，GLM-4-9B-Chat 展现了优秀的性能，如 AlignBench-v2、MT-Bench、MMLU 和 C-Eval 等。该模型支持最大 128K 的上下文长度，适用于学术研究和商业应用',
    displayName: 'GLM-4 9B Chat (Free)',
    id: 'THUDM/glm-4-9b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-06-04',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GLM-4-9B-Chat 是智谱 AI 推出的 GLM-4 系列预训练模型中的开源版本。该模型在语义、数学、推理、代码和知识等多个方面表现出色。除了支持多轮对话外，GLM-4-9B-Chat 还具备网页浏览、代码执行、自定义工具调用（Function Call）和长文本推理等高级功能。模型支持 26 种语言，包括中文、英文、日语、韩语和德语等。在多项基准测试中，GLM-4-9B-Chat 展现了优秀的性能，如 AlignBench-v2、MT-Bench、MMLU 和 C-Eval 等。该模型支持最大 128K 的上下文长度，适用于学术研究和商业应用',
    displayName: 'GLM-4 9B Chat (Pro)',
    id: 'Pro/THUDM/glm-4-9b-chat',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-06-04',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1-0528-Qwen3-8B 是通过从 DeepSeek-R1-0528 模型蒸馏思维链到 Qwen3 8B Base 获得的模型。该模型在开源模型中达到了最先进（SOTA）的性能，在 AIME 2024 测试中超越了 Qwen3 8B 10%，并达到了 Qwen3-235B-thinking 的性能水平。该模型在数学推理、编程和通用逻辑等多个基准测试中表现出色，其架构与 Qwen3-8B 相同，但共享 DeepSeek-R1-0528 的分词器配置。',
    displayName: 'DeepSeek R1 0528 Qwen3 8B (Free)',
    id: 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 98_304,
    description:
      'DeepSeek-R1 是一款强化学习（RL）驱动的推理模型，解决了模型中的重复性和可读性问题。在 RL 之前，DeepSeek-R1 引入了冷启动数据，进一步优化了推理性能。它在数学、代码和推理任务中与 OpenAI-o1 表现相当，并且通过精心设计的训练方法，提升了整体效果。',
    displayName: 'DeepSeek R1',
    id: 'deepseek-ai/DeepSeek-R1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 是一款拥有 6710 亿参数的混合专家（MoE）语言模型，采用多头潜在注意力（MLA）和 DeepSeekMoE 架构，结合无辅助损失的负载平衡策略，优化推理和训练效率。通过在 14.8 万亿高质量tokens上预训练，并进行监督微调和强化学习，DeepSeek-V3 在性能上超越其他开源模型，接近领先闭源模型。',
    displayName: 'DeepSeek V3',
    id: 'deepseek-ai/DeepSeek-V3',
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
    contextWindowTokens: 98_304,
    description:
      'DeepSeek-R1 是一款强化学习（RL）驱动的推理模型，解决了模型中的重复性和可读性问题。在 RL 之前，DeepSeek-R1 引入了冷启动数据，进一步优化了推理性能。它在数学、代码和推理任务中与 OpenAI-o1 表现相当，并且通过精心设计的训练方法，提升了整体效果。',
    displayName: 'DeepSeek R1 (Pro)',
    id: 'Pro/deepseek-ai/DeepSeek-R1',
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
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 是一款拥有 6710 亿参数的混合专家（MoE）语言模型，采用多头潜在注意力（MLA）和 DeepSeekMoE 架构，结合无辅助损失的负载平衡策略，优化推理和训练效率。通过在 14.8 万亿高质量tokens上预训练，并进行监督微调和强化学习，DeepSeek-V3 在性能上超越其他开源模型，接近领先闭源模型。',
    displayName: 'DeepSeek V3 (Pro)',
    id: 'Pro/deepseek-ai/DeepSeek-V3',
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
      'DeepSeek-R1-Distill-Qwen-32B 是基于 Qwen2.5-32B 通过知识蒸馏得到的模型。该模型使用 DeepSeek-R1 生成的 80 万个精选样本进行微调，在数学、编程和推理等多个领域展现出卓越的性能。在 AIME 2024、MATH-500、GPQA Diamond 等多个基准测试中都取得了优异成绩，其中在 MATH-500 上达到了 94.3% 的准确率，展现出强大的数学推理能力。',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-32B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-R1-Distill-Qwen-14B 是基于 Qwen2.5-14B 通过知识蒸馏得到的模型。该模型使用 DeepSeek-R1 生成的 80 万个精选样本进行微调，展现出优秀的推理能力。在多个基准测试中表现出色，其中在 MATH-500 上达到了 93.9% 的准确率，在 AIME 2024 上达到了 69.7% 的通过率，在 CodeForces 上获得了 1481 的评分，显示出在数学和编程领域的强大实力。',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-R1-Distill-Qwen-7B 是基于 Qwen2.5-Math-7B 通过知识蒸馏得到的模型。该模型使用 DeepSeek-R1 生成的 80 万个精选样本进行微调，展现出优秀的推理能力。在多个基准测试中表现出色，其中在 MATH-500 上达到了 92.8% 的准确率，在 AIME 2024 上达到了 55.5% 的通过率，在 CodeForces 上获得了 1189 的评分，作为 7B 规模的模型展示了较强的数学和编程能力。',
    displayName: 'DeepSeek R1 Distill Qwen 7B (Free)',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1-Distill-Qwen-7B 是基于 Qwen2.5-Math-7B 通过知识蒸馏得到的模型。该模型使用 DeepSeek-R1 生成的 80 万个精选样本进行微调，展现出优秀的推理能力。在多个基准测试中表现出色，其中在 MATH-500 上达到了 92.8% 的准确率，在 AIME 2024 上达到了 55.5% 的通过率，在 CodeForces 上获得了 1189 的评分，作为 7B 规模的模型展示了较强的数学和编程能力。',
    displayName: 'DeepSeek R1 Distill Qwen 7B (Pro)',
    id: 'Pro/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-V2.5 是 DeepSeek-V2-Chat 和 DeepSeek-Coder-V2-Instruct 的升级版本，集成了两个先前版本的通用和编码能力。该模型在多个方面进行了优化，包括写作和指令跟随能力，更好地与人类偏好保持一致。DeepSeek-V2.5 在各种评估基准上都取得了显著的提升，如 AlpacaEval 2.0、ArenaHard、AlignBench 和 MT-Bench 等。',
    displayName: 'DeepSeek V2.5',
    id: 'deepseek-ai/DeepSeek-V2.5',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.33, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.33, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'DeepSeek-VL2 是一个基于 DeepSeekMoE-27B 开发的混合专家（MoE）视觉语言模型，采用稀疏激活的 MoE 架构，在仅激活 4.5B 参数的情况下实现了卓越性能。该模型在视觉问答、光学字符识别、文档/表格/图表理解和视觉定位等多个任务中表现优异。',
    displayName: 'DeepSeek VL2',
    id: 'deepseek-ai/deepseek-vl2',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.99, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'QVQ-72B-Preview 是由 Qwen 团队开发的专注于视觉推理能力的研究型模型，其在复杂场景理解和解决视觉相关的数学问题方面具有独特优势。',
    displayName: 'QVQ 72B Preview',
    id: 'Qwen/QVQ-72B-Preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 9.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9.9, strategy: 'fixed', unit: 'millionTokens' },
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
      'QwQ 是 Qwen 系列的推理模型。与传统的指令调优模型相比，QwQ 具备思考和推理能力，能够在下游任务中实现显著增强的性能，尤其是在解决困难问题方面。QwQ-32B 是中型推理模型，能够在与最先进的推理模型（如 DeepSeek-R1、o1-mini）的对比中取得有竞争力的性能。该模型采用 RoPE、SwiGLU、RMSNorm 和 Attention QKV bias 等技术，具有 64 层网络结构和 40 个 Q 注意力头（GQA 架构中 KV 为 8 个）。',
    displayName: 'QwQ 32B',
    id: 'Qwen/QwQ-32B',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-7B-Instruct 是阿里云发布的最新大语言模型系列之一。该 7B 模型在编码和数学等领域具有显著改进的能力。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 7B Instruct (Free)',
    id: 'Qwen/Qwen2.5-7B-Instruct',
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
      'Qwen2.5-7B-Instruct 是阿里云发布的最新大语言模型系列之一。该 7B 模型在编码和数学等领域具有显著改进的能力。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 7B Instruct (Pro)',
    id: 'Pro/Qwen/Qwen2.5-7B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-14B-Instruct 是阿里云发布的最新大语言模型系列之一。该 14B 模型在编码和数学等领域具有显著改进的能力。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 14B Instruct',
    id: 'Qwen/Qwen2.5-14B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-32B-Instruct 是阿里云发布的最新大语言模型系列之一。该 32B 模型在编码和数学等领域具有显著改进的能力。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 32B Instruct',
    id: 'Qwen/Qwen2.5-32B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-72B-Instruct 是阿里云发布的最新大语言模型系列之一。该 72B 模型在编码和数学等领域具有显著改进的能力。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 72B Instruct',
    id: 'Qwen/Qwen2.5-72B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-72B-Instruct 是阿里云发布的最新大语言模型系列之一。该 72B 模型在编码和数学等领域具有显著改进的能力。它支持长达 128K tokens 的输入，可以生成超过 8K tokens 的长文本。该模型还提供了多语言支持，覆盖超过 29 种语言，包括中文、英文等。模型在指令跟随、理解结构化数据以及生成结构化输出（尤其是 JSON）方面都有显著提升',
    displayName: 'Qwen2.5 72B Instruct 128K',
    id: 'Qwen/Qwen2.5-72B-Instruct-128K',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder-7B-Instruct 是阿里云发布的代码特定大语言模型系列的最新版本。该模型在 Qwen2.5 的基础上，通过 5.5 万亿个 tokens 的训练，显著提升了代码生成、推理和修复能力。它不仅增强了编码能力，还保持了数学和通用能力的优势。模型为代码智能体等实际应用提供了更全面的基础',
    displayName: 'Qwen2.5 Coder 7B Instruct (Free)',
    id: 'Qwen/Qwen2.5-Coder-7B-Instruct',
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
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder-7B-Instruct 是阿里云发布的代码特定大语言模型系列的最新版本。该模型在 Qwen2.5 的基础上，通过 5.5 万亿个 tokens 的训练，显著提升了代码生成、推理和修复能力。它不仅增强了编码能力，还保持了数学和通用能力的优势。模型为代码智能体等实际应用提供了更全面的基础',
    displayName: 'Qwen2.5 Coder 7B Instruct (Pro)',
    id: 'Pro/Qwen/Qwen2.5-Coder-7B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder-32B-Instruct 是基于 Qwen2.5 开发的代码特定大语言模型。该模型通过 5.5 万亿 tokens 的训练，在代码生成、代码推理和代码修复方面都取得了显著提升。它是当前最先进的开源代码语言模型，编码能力可与 GPT-4 相媲美。模型不仅增强了编码能力，还保持了在数学和通用能力方面的优势，并支持长文本处理',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2-7B-Instruct 是 Qwen2 系列中的指令微调大语言模型，参数规模为 7B。该模型基于 Transformer 架构，采用了 SwiGLU 激活函数、注意力 QKV 偏置和组查询注意力等技术。它能够处理大规模输入。该模型在语言理解、生成、多语言能力、编码、数学和推理等多个基准测试中表现出色，超越了大多数开源模型，并在某些任务上展现出与专有模型相当的竞争力。Qwen2-7B-Instruct 在多项评测中均优于 Qwen1.5-7B-Chat，显示出显著的性能提升',
    displayName: 'Qwen2 7B Instruct (Free)',
    id: 'Qwen/Qwen2-7B-Instruct',
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
    contextWindowTokens: 32_768,
    description:
      'Qwen2-7B-Instruct 是 Qwen2 系列中的指令微调大语言模型，参数规模为 7B。该模型基于 Transformer 架构，采用了 SwiGLU 激活函数、注意力 QKV 偏置和组查询注意力等技术。它能够处理大规模输入。该模型在语言理解、生成、多语言能力、编码、数学和推理等多个基准测试中表现出色，超越了大多数开源模型，并在某些任务上展现出与专有模型相当的竞争力。Qwen2-7B-Instruct 在多项评测中均优于 Qwen1.5-7B-Chat，显示出显著的性能提升',
    displayName: 'Qwen2 7B Instruct (Pro)',
    id: 'Pro/Qwen/Qwen2-7B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2-VL 是 Qwen-VL 模型的最新迭代版本，在视觉理解基准测试中达到了最先进的性能，包括 MathVista、DocVQA、RealWorldQA 和 MTVQA 等。Qwen2-VL 能够理解超过 20 分钟的视频，用于高质量的基于视频的问答、对话和内容创作。它还具备复杂推理和决策能力，可以与移动设备、机器人等集成，基于视觉环境和文本指令进行自动操作。除了英语和中文，Qwen2-VL 现在还支持理解图像中不同语言的文本，包括大多数欧洲语言、日语、韩语、阿拉伯语和越南语等',
    displayName: 'Qwen2 VL 72B Instruct',
    id: 'Qwen/Qwen2-VL-72B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-VL 是 Qwen 系列的新成员，具备强大的视觉理解能力，能分析图像中的文本、图表和布局，并能理解长视频和捕捉事件，它可以进行推理、操作工具，支持多格式物体定位和生成结构化输出，优化了视频理解的动态分辨率与帧率训练，并提升了视觉编码器效率。',
    displayName: 'Qwen2.5 VL 7B Instruct (Pro)',
    id: 'Pro/Qwen/Qwen2.5-VL-7B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.35, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-VL-32B-Instruct 是通义千问团队推出的多模态大模型，是 Qwen2.5-VL 系列的一部分。该模型不仅精通识别常见物体，还能分析图像中的文本、图表、图标、图形和布局。它可作为视觉智能体，能够推理并动态操控工具，具备使用电脑和手机的能力。此外，这个模型可以精确定位图像中的对象，并为发票、表格等生成结构化输出。相比前代模型 Qwen2-VL，该版本在数学和问题解决能力方面通过强化学习得到了进一步提升，响应风格也更符合人类偏好。',
    displayName: 'Qwen2.5 VL 32B Instruct',
    id: 'Qwen/Qwen2.5-VL-32B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.89, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.89, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5-VL 是 Qwen2.5 系列中的视觉语言模型。该模型在多方面有显著提升：具备更强的视觉理解能力，能够识别常见物体、分析文本、图表和布局；作为视觉代理能够推理并动态指导工具使用；支持理解超过 1 小时的长视频并捕捉关键事件；能够通过生成边界框或点准确定位图像中的物体；支持生成结构化输出，尤其适用于发票、表格等扫描数据。',
    displayName: 'Qwen2.5 VL 72B Instruct',
    id: 'Qwen/Qwen2.5-VL-72B-Instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.13, strategy: 'fixed', unit: 'millionTokens' },
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
      'InternLM2.5-7B-Chat 是一个开源的对话模型，基于 InternLM2 架构开发。该 7B 参数规模的模型专注于对话生成任务，支持中英双语交互。模型采用了最新的训练技术，旨在提供流畅、智能的对话体验。InternLM2.5-7B-Chat 适用于各种对话应用场景，包括但不限于智能客服、个人助手等领域',
    displayName: 'InternLM2.5 7B Chat (Free)',
    id: 'internlm/internlm2_5-7b-chat',
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

const siliconcloudImageModels: AIImageModelCard[] = [
  {
    description:
      'Kolors 是由快手 Kolors 团队开发的基于潜在扩散的大规模文本到图像生成模型。该模型通过数十亿文本-图像对的训练，在视觉质量、复杂语义准确性以及中英文字符渲染方面展现出显著优势。它不仅支持中英文输入，在理解和生成中文特定内容方面也表现出色',
    displayName: 'Kolors',
    enabled: true,
    id: 'Kwai-Kolors/Kolors',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '960x1280', '768x1024', '720x1440', '720x1280'],
      },
    },
    releasedAt: '2024-07-06',
    type: 'image',
  },
  {
    description:
      'Qwen-Image 是由阿里巴巴通义千问团队发布的图像生成基础模型，拥有 200 亿参数。该模型在复杂的文本渲染和精确的图像编辑方面取得了显著进展，尤其擅长生成包含高保真度中英文文字的图像。Qwen-Image 不仅能够处理多行布局和段落级文本，还能在生成图像时保持排版的连贯性和上下文的和谐。除了卓越的文本渲染能力，该模型还支持广泛的艺术风格，从写实照片到动漫美学，能够灵活适应各种创作需求。同时，它也具备强大的图像编辑和理解能力，支持风格迁移、物体增删、细节增强、文本编辑乃至人体姿态操控等高级操作，旨在成为一个集语言、布局和图像于一体的综合性智能视觉创作与处理基础模型',
    displayName: 'Qwen-Image',
    enabled: true,
    id: 'Qwen/Qwen-Image',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1328x1328',
        enum: ['1328x1328', '1584x1056', '1140x1472', '1664x928', '928x1664'],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-08-04',
    type: 'image',
  },
  {
    description:
      'Qwen-Image-Edit-2509 是由阿里巴巴通义千问团队发布的 Qwen-Image 的图像编辑最新版本。该模型基于 20B 参数的 Qwen-Image 模型进行深入训练，将其独特的文本渲染能力成功扩展至图像编辑领域，实现了对图片中文字的精准编辑。此外，Qwen-Image-Edit 采用了一种创新的架构，将输入图像同时送入 Qwen2.5-VL（用于视觉语义控制）和 VAE Encoder（用于视觉外观控制），从而兼具语义与外观的双重编辑能力。这意味着它不仅支持元素的添加、删除或修改等局部外观编辑，还支持如 IP 创作、风格迁移等需要保持语义一致性的高阶视觉语义编辑。模型在多个公开基准测试中展现了顶尖（SOTA）的性能，使其成为一个强大的图像编辑基础模型',
    displayName: 'Qwen-Image-Edit (2509)',
    enabled: true,
    id: 'Qwen/Qwen-Image-Edit-2509',
    parameters: {
      imageUrls: {
        default: [],
        maxCount: 3,
      },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.04, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-09-22',
    type: 'image',
  },
];

export const allModels = [...siliconcloudChatModels, ...siliconcloudImageModels];

export default allModels;
