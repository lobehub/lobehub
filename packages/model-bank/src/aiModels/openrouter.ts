import { AIChatModelCard } from '../types/aiModel';

// https://openrouter.ai/docs/api-reference/list-available-models
const openrouterChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 2_000_000,
    description:
      '根据上下文长度、主题和复杂性，你的请求将发送到 Llama 3 405B Instruct、Claude 3.5 Sonnet 或 GPT-4o 等模型。',
    displayName: 'Auto Router',
    id: 'openrouter/auto',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1是一款支持128K长上下文和高效模式切换的大型混合推理模型，它在工具调用、代码生成和复杂推理任务上实现了卓越的性能与速度。',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-21',
    type: 'chat',
  },
  {
    abilities: {
      imageOutput: true,
      vision: true,
    },
    contextWindowTokens: 32_768 + 8192,
    description: 'Gemini 2.5 Flash 实验模型，支持图像生成',
    displayName: 'Nano Banana',
    id: 'google/gemini-2.5-flash-image-preview',
    maxOutput: 8192,
    pricing: {
      approximatePricePerImage: 0.039,
      units: [
        { name: 'imageOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-26',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-V3.1是一款支持128K长上下文和高效模式切换的大型混合推理模型，它在工具调用、代码生成和复杂推理任务上实现了卓越的性能与速度。',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek/deepseek-chat-v3.1',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-21',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 大型语言模型系列的最新一代，具有密集和专家混合 (MoE) 架构，在推理、多语言支持和高级代理任务方面表现出色。其在复杂推理的思考模式和高效对话的非思考模式之间无缝切换的独特能力确保了多功能、高质量的性能。\n\nQwen3 显著优于 QwQ 和 Qwen2.5 等先前模型，提供卓越的数学、编码、常识推理、创意写作和交互式对话能力。Qwen3-30B-A3B 变体包含 305 亿个参数（33 亿个激活参数）、48 层、128 个专家（每个任务激活 8 个），并支持高达 131K 令牌上下文（使用 YaRN），为开源模型树立了新标准。',
    displayName: 'Qwen3 30B A3B (Free)',
    id: 'qwen/qwen3-30b-a3b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3 是 Qwen 大型语言模型系列的最新一代，具有密集和专家混合 (MoE) 架构，在推理、多语言支持和高级代理任务方面表现出色。其在复杂推理的思考模式和高效对话的非思考模式之间无缝切换的独特能力确保了多功能、高质量的性能。\n\nQwen3 显著优于 QwQ 和 Qwen2.5 等先前模型，提供卓越的数学、编码、常识推理、创意写作和交互式对话能力。Qwen3-30B-A3B 变体包含 305 亿个参数（33 亿个激活参数）、48 层、128 个专家（每个任务激活 8 个），并支持高达 131K 令牌上下文（使用 YaRN），为开源模型树立了新标准。',
    displayName: 'Qwen3 30B A3B',
    id: 'qwen/qwen3-30b-a3b',
    maxOutput: 40_960,
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
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-8B 是 Qwen3 系列中一个密集的 82 亿参数因果语言模型，专为推理密集型任务和高效对话而设计。它支持在用于数学、编码和逻辑推理的“思考”模式与用于一般对话的“非思考”模式之间无缝切换。该模型经过微调，可用于指令遵循、代理集成、创意写作以及跨 100 多种语言和方言的多语言使用。它原生支持 32K 令牌上下文窗口，并可通过 YaRN 扩展到 131K 令牌。',
    displayName: 'Qwen3 8B (Free)',
    id: 'qwen/qwen3-8b:free',
    maxOutput: 40_960,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-14B 是 Qwen3 系列中一个密集的 148 亿参数因果语言模型，专为复杂推理和高效对话而设计。它支持在用于数学、编程和逻辑推理等任务的“思考”模式与用于通用对话的“非思考”模式之间无缝切换。该模型经过微调，可用于指令遵循、代理工具使用、创意写作以及跨 100 多种语言和方言的多语言任务。它原生处理 32K 令牌上下文，并可使用基于 YaRN 的扩展扩展到 131K 令牌。',
    displayName: 'Qwen3 14B (Free)',
    id: 'qwen/qwen3-14b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-14B 是 Qwen3 系列中一个密集的 148 亿参数因果语言模型，专为复杂推理和高效对话而设计。它支持在用于数学、编程和逻辑推理等任务的“思考”模式与用于通用对话的“非思考”模式之间无缝切换。该模型经过微调，可用于指令遵循、代理工具使用、创意写作以及跨 100 多种语言和方言的多语言任务。它原生处理 32K 令牌上下文，并可使用基于 YaRN 的扩展扩展到 131K 令牌。',
    displayName: 'Qwen3 14B',
    id: 'qwen/qwen3-14b',
    maxOutput: 40_960,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-32B 是 Qwen3 系列中一个密集的 328 亿参数因果语言模型，针对复杂推理和高效对话进行了优化。它支持在用于数学、编码和逻辑推理等任务的“思考”模式与用于更快、通用对话的“非思考”模式之间无缝切换。该模型在指令遵循、代理工具使用、创意写作以及跨 100 多种语言和方言的多语言任务中表现出强大的性能。它原生处理 32K 令牌上下文，并可使用基于 YaRN 的扩展扩展到 131K 令牌。',
    displayName: 'Qwen3 32B',
    id: 'qwen/qwen3-32b',
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
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3-235B-A22B 是由 Qwen 开发的 235B 参数专家混合 (MoE) 模型，每次前向传递激活 22B 参数。它支持在用于复杂推理、数学和代码任务的“思考”模式与用于一般对话效率的“非思考”模式之间无缝切换。该模型展示了强大的推理能力、多语言支持（100 多种语言和方言）、高级指令遵循和代理工具调用能力。它原生处理 32K 令牌上下文窗口，并使用基于 YaRN 的扩展扩展到 131K 令牌。',
    displayName: 'Qwen3 235B A22B (Free)',
    id: 'qwen/qwen3-235b-a22b:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 40_960,
    description:
      'Qwen3-235B-A22B 是由 Qwen 开发的 235B 参数专家混合 (MoE) 模型，每次前向传递激活 22B 参数。它支持在用于复杂推理、数学和代码任务的“思考”模式与用于一般对话效率的“非思考”模式之间无缝切换。该模型展示了强大的推理能力、多语言支持（100 多种语言和方言）、高级指令遵循和代理工具调用能力。它原生处理 32K 令牌上下文窗口，并使用基于 YaRN 的扩展扩展到 131K 令牌。',
    displayName: 'Qwen3 235B A22B',
    id: 'qwen/qwen3-235b-a22b',
    maxOutput: 40_960,
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
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1T-Chimera 通过合并 DeepSeek-R1 和 DeepSeek-V3 (0324) 创建，结合了 R1 的推理能力和 V3 的令牌效率改进。它基于 DeepSeek-MoE Transformer 架构，并针对通用文本生成任务进行了优化。\n\n该模型合并了两个源模型的预训练权重，以平衡推理、效率和指令遵循任务的性能。它根据 MIT 许可证发布，旨在用于研究和商业用途。',
    displayName: 'DeepSeek R1T Chimera (Free)',
    id: 'tngtech/deepseek-r1t-chimera:free',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'GLM Z1 Rumination 32B 是 GLM-4-Z1 系列中的 32B 参数深度推理模型，针对需要长时间思考的复杂、开放式任务进行了优化。它建立在 glm-4-32b-0414 的基础上，增加了额外的强化学习阶段和多阶段对齐策略，引入了旨在模拟扩展认知处理的“反思”能力。这包括迭代推理、多跳分析和工具增强的工作流程，例如搜索、检索和引文感知合成。\n\n该模型在研究式写作、比较分析和复杂问答方面表现出色。它支持用于搜索和导航原语（`search`、`click`、`open`、`finish`）的函数调用，从而可以在代理式管道中使用。反思行为由具有基于规则的奖励塑造和延迟决策机制的多轮循环控制，并以 OpenAI 内部对齐堆栈等深度研究框架为基准。此变体适用于需要深度而非速度的场景。',
    displayName: 'GLM Z1 Rumination 32B',
    id: 'thudm/glm-z1-rumination-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'GLM-Z1-32B-0414 是 GLM-4-32B 的增强推理变体，专为深度数学、逻辑和面向代码的问题解决而构建。它应用扩展强化学习（任务特定和基于通用成对偏好）来提高复杂多步骤任务的性能。与基础 GLM-4-32B 模型相比，Z1 显著提升了结构化推理和形式化领域的能力。\n\n该模型支持通过提示工程强制执行“思考”步骤，并为长格式输出提供改进的连贯性。它针对代理工作流进行了优化，并支持长上下文（通过 YaRN）、JSON 工具调用和用于稳定推理的细粒度采样配置。非常适合需要深思熟虑、多步骤推理或形式化推导的用例。',
    displayName: 'GLM Z1 32B',
    id: 'thudm/glm-z1-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
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
      'GLM-4-32B-0414 是一个 32B 双语（中英）开放权重语言模型，针对代码生成、函数调用和代理式任务进行了优化。它在 15T 高质量和重推理数据上进行了预训练，并使用人类偏好对齐、拒绝采样和强化学习进一步完善。该模型在复杂推理、工件生成和结构化输出任务方面表现出色，在多个基准测试中达到了与 GPT-4o 和 DeepSeek-V3-0324 相当的性能。',
    displayName: 'GLM 4 32B',
    id: 'thudm/glm-4-32b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
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
      'Gemini 2.5 Pro 是 Google 最先进的思维模型，能够对代码、数学和STEM领域的复杂问题进行推理，以及使用长上下文分析大型数据集、代码库和文档。',
    displayName: 'Gemini 2.5 Pro',
    id: 'google/gemini-2.5-pro',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
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
      'Gemini 2.5 Pro Preview 是 Google 最先进的思维模型，能够对代码、数学和STEM领域的复杂问题进行推理，以及使用长上下文分析大型数据集、代码库和文档。',
    displayName: 'Gemini 2.5 Pro Preview',
    id: 'google/gemini-2.5-pro-preview',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
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
      'Gemini 2.5 Flash 是 Google 最先进的主力模型，专为高级推理、编码、数学和科学任务而设计。它包含内置的“思考”能力，使其能够提供具有更高准确性和细致上下文处理的响应。\n\n注意：此模型有两个变体：思考和非思考。输出定价根据思考能力是否激活而有显著差异。如果您选择标准变体（不带“:thinking”后缀），模型将明确避免生成思考令牌。\n\n要利用思考能力并接收思考令牌，您必须选择“:thinking”变体，这将产生更高的思考输出定价。\n\n此外，Gemini 2.5 Flash 可通过“推理最大令牌数”参数进行配置，如文档中所述 (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning)。',
    displayName: 'Gemini 2.5 Flash',
    id: 'google/gemini-2.5-flash',
    maxOutput: 65_535,
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash 是 Google 最先进的主力模型，专为高级推理、编码、数学和科学任务而设计。它包含内置的“思考”能力，使其能够提供具有更高准确性和细致上下文处理的响应。\n\n注意：此模型有两个变体：思考和非思考。输出定价根据思考能力是否激活而有显著差异。如果您选择标准变体（不带“:thinking”后缀），模型将明确避免生成思考令牌。\n\n要利用思考能力并接收思考令牌，您必须选择“:thinking”变体，这将产生更高的思考输出定价。\n\n此外，Gemini 2.5 Flash 可通过“推理最大令牌数”参数进行配置，如文档中所述 (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning)。',
    displayName: 'Gemini 2.5 Flash Preview',
    id: 'google/gemini-2.5-flash-preview',
    maxOutput: 65_535,
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
    contextWindowTokens: 1_048_576,
    description:
      'Gemini 2.5 Flash 是 Google 最先进的主力模型，专为高级推理、编码、数学和科学任务而设计。它包含内置的“思考”能力，使其能够提供具有更高准确性和细致上下文处理的响应。\n\n注意：此模型有两个变体：思考和非思考。输出定价根据思考能力是否激活而有显著差异。如果您选择标准变体（不带“:thinking”后缀），模型将明确避免生成思考令牌。\n\n要利用思考能力并接收思考令牌，您必须选择“:thinking”变体，这将产生更高的思考输出定价。\n\n此外，Gemini 2.5 Flash 可通过“推理最大令牌数”参数进行配置，如文档中所述 (https://openrouter.ai/docs/use-cases/reasoning-tokens#max-tokens-for-reasoning)。',
    displayName: 'Gemini 2.5 Flash Preview (thinking)',
    id: 'google/gemini-2.5-flash-preview:thinking',
    maxOutput: 65_535,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'o3 是一款全能强大的模型，在多个领域表现出色。它为数学、科学、编程和视觉推理任务树立了新标杆。它也擅长技术写作和指令遵循。用户可利用它分析文本、代码和图像，解决多步骤的复杂问题。',
    displayName: 'o3',
    id: 'openai/o3',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
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
      'o4-mini 高推理等级版，专为快速有效的推理而优化，在编码和视觉任务中表现出极高的效率和性能。',
    displayName: 'o4-mini (high)',
    id: 'openai/o4-mini-high',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'o4-mini 专为快速有效的推理而优化，在编码和视觉任务中表现出极高的效率和性能。',
    displayName: 'o4-mini',
    id: 'openai/o4-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.275, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 是我们用于复杂任务的旗舰模型。它非常适合跨领域解决问题。',
    displayName: 'GPT-4.1',
    id: 'openai/gpt-4.1',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description:
      'GPT-4.1 mini 提供了智能、速度和成本之间的平衡，使其成为许多用例中有吸引力的模型。',
    displayName: 'GPT-4.1 mini',
    id: 'openai/gpt-4.1-mini',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-04-14',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_047_576,
    description: 'GPT-4.1 nano 是最快，最具成本效益的GPT-4.1模型。',
    displayName: 'GPT-4.1 nano',
    id: 'openai/gpt-4.1-nano',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description: 'o3-mini 高推理等级版，在与 o1-mini 相同的成本和延迟目标下提供高智能。',
    displayName: 'o3-mini (high)',
    id: 'openai/o3-mini-high',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description: 'o3-mini 在与 o1-mini 相同的成本和延迟目标下提供高智能。',
    displayName: 'o3-mini',
    id: 'openai/o3-mini',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-31',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
    displayName: 'o1-mini',
    id: 'openai/o1-mini',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o1是OpenAI新的推理模型，适用于需要广泛通用知识的复杂任务。该模型具有128K上下文和2023年10月的知识截止日期。',
    displayName: 'o1-preview',
    id: 'openai/o1-preview',
    maxOutput: 32_768,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4o mini是OpenAI在GPT-4 Omni之后推出的最新模型，支持图文输入并输出文本。作为他们最先进的小型模型，它比其他近期的前沿模型便宜很多，并且比GPT-3.5 Turbo便宜超过60%。它保持了最先进的智能，同时具有显著的性价比。GPT-4o mini在MMLU测试中获得了 82% 的得分，目前在聊天偏好上排名高于 GPT-4。',
    displayName: 'GPT-4o mini',
    id: 'openai/gpt-4o-mini',
    maxOutput: 16_385,
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o 是一款动态模型，实时更新以保持当前最新版本。它结合了强大的语言理解与生成能力，适合于大规模应用场景，包括客户服务、教育和技术支持。',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
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
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 在仅有极少标注数据的情况下，极大提升了模型推理能力。在输出最终回答之前，模型会先输出一段思维链内容，以提升最终答案的准确性。',
    displayName: 'DeepSeek R1 0528',
    id: 'deepseek/deepseek-r1-0528',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 在仅有极少标注数据的情况下，极大提升了模型推理能力。在输出最终回答之前，模型会先输出一段思维链内容，以提升最终答案的准确性。',
    displayName: 'DeepSeek R1 0528 (Free)',
    id: 'deepseek/deepseek-r1-0528:free',
    releasedAt: '2025-05-28',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 在仅有极少标注数据的情况下，极大提升了模型推理能力。在输出最终回答之前，模型会先输出一段思维链内容，以提升最终答案的准确性。',
    displayName: 'DeepSeek R1',
    id: 'deepseek/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-20',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek-R1 在仅有极少标注数据的情况下，极大提升了模型推理能力。在输出最终回答之前，模型会先输出一段思维链内容，以提升最终答案的准确性。',
    displayName: 'DeepSeek R1 (Free)',
    id: 'deepseek/deepseek-r1:free',
    releasedAt: '2025-01-20',
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 是一个 685B 参数的专家混合模型，是 DeepSeek 团队旗舰聊天模型系列的最新迭代。\n\n它继承了 [DeepSeek V3](/deepseek/deepseek-chat-v3) 模型，并在各种任务上表现出色。',
    displayName: 'DeepSeek V3 0324',
    id: 'deepseek/deepseek-chat-v3-0324',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.27, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3 是一个 685B 参数的专家混合模型，是 DeepSeek 团队旗舰聊天模型系列的最新迭代。\n\n它继承了 [DeepSeek V3](/deepseek/deepseek-chat-v3) 模型，并在各种任务上表现出色。',
    displayName: 'DeepSeek V3 0324 (Free)',
    id: 'deepseek/deepseek-chat-v3-0324:free',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude Opus 4.5 是 Anthropic 的旗舰模型，结合了卓越的智能与可扩展性能，适合需要最高质量回应和推理能力的复杂任务。',
    displayName: 'Claude Opus 4.5',
    id: 'anthropic/claude-opus-4.5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: 'Claude Sonnet 4.5 是 Anthropic 迄今为止最智能的模型。',
    displayName: 'Claude Sonnet 4.5',
    id: 'anthropic/claude-sonnet-4.5',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-30',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
      searchImpl: 'params',
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
      'Claude 3 Haiku 是 Anthropic 的最快且最紧凑的模型，旨在实现近乎即时的响应。它具有快速且准确的定向性能。',
    displayName: 'Claude 3 Haiku',
    id: 'anthropic/claude-3-haiku',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 0.3125 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-03-07',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Haiku 是 Anthropic 最快的下一代模型。与 Claude 3 Haiku 相比，Claude 3.5 Haiku 在各项技能上都有所提升，并在许多智力基准测试中超越了上一代最大的模型 Claude 3 Opus。',
    displayName: 'Claude 3.5 Haiku',
    id: 'anthropic/claude-3.5-haiku',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 1.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-11-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3.5 Sonnet 提供了超越 Opus 的能力和比 Sonnet 更快的速度，同时保持与 Sonnet 相同的价格。Sonnet 特别擅长编程、数据科学、视觉处理、代理任务。',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic/claude-3.5-sonnet',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-06-20',
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
      'Claude 3.7 Sonnet 是 Anthropic 迄今为止最智能的模型，也是市场上首个混合推理模型。Claude 3.7 Sonnet 可以产生近乎即时的响应或延长的逐步思考，用户可以清晰地看到这些过程。Sonnet 特别擅长编程、数据科学、视觉处理、代理任务。',
    displayName: 'Claude 3.7 Sonnet',
    id: 'anthropic/claude-3.7-sonnet',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 3.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-02-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'Claude Sonnet 4 可以产生近乎即时的响应或延长的逐步思考，用户可以清晰地看到这些过程。API 用户还可以对模型思考的时间进行细致的控制',
    displayName: 'Claude Sonnet 4',
    id: 'anthropic/claude-sonnet-4',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
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
      'Claude Opus 4 是 Anthropic 用于处理高度复杂任务的最强大模型。它在性能、智能、流畅性和理解力方面表现卓越。',
    displayName: 'Claude Opus 4',
    id: 'anthropic/claude-opus-4',
    maxOutput: 32_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-23',
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Opus 是 Anthropic 用于处理高度复杂任务的最强大模型。它在性能、智能、流畅性和理解力方面表现卓越。',
    displayName: 'Claude 3 Opus',
    id: 'anthropic/claude-3-opus',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '5m': 18.75 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2024-02-29',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576 + 8192,
    description:
      'Gemini 2.0 Flash 提供下一代功能和改进，包括卓越的速度、原生工具使用、多模态生成和1M令牌上下文窗口。',
    displayName: 'Gemini 2.0 Flash',
    id: 'google/gemini-2.0-flash-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-05',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 旨在处理结合视觉和文本数据的任务。它在图像描述和视觉问答等任务中表现出色，跨越了语言生成和视觉推理之间的鸿沟。',
    displayName: 'Llama 3.2 11B Vision',
    id: 'meta-llama/llama-3.2-11b-vision-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.162, strategy: 'fixed', unit: 'millionTokens' },
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
      'LLaMA 3.2 旨在处理结合视觉和文本数据的任务。它在图像描述和视觉问答等任务中表现出色，跨越了语言生成和视觉推理之间的鸿沟。',
    displayName: 'Llama 3.2 90B Vision',
    id: 'meta-llama/llama-3.2-90b-vision-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
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
      'Llama 3.3 是 Llama 系列最先进的多语言开源大型语言模型，以极低成本体验媲美 405B 模型的性能。基于 Transformer 结构，并通过监督微调（SFT）和人类反馈强化学习（RLHF）提升有用性和安全性。其指令调优版本专为多语言对话优化，在多项行业基准上表现优于众多开源和封闭聊天模型。知识截止日期为 2023 年 12 月',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta-llama/llama-3.3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.12, strategy: 'fixed', unit: 'millionTokens' },
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
    description:
      'Llama 3.3 是 Llama 系列最先进的多语言开源大型语言模型，以极低成本体验媲美 405B 模型的性能。基于 Transformer 结构，并通过监督微调（SFT）和人类反馈强化学习（RLHF）提升有用性和安全性。其指令调优版本专为多语言对话优化，在多项行业基准上表现优于众多开源和封闭聊天模型。知识截止日期为 2023 年 12 月',
    displayName: 'Llama 3.3 70B Instruct (Free)',
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Gemma 2 是Google轻量化的开源文本模型系列。',
    displayName: 'Gemma 2 9B (Free)',
    id: 'google/gemma-2-9b-it:free',
    type: 'chat',
  },
];

export const allModels = [...openrouterChatModels];

export default allModels;
