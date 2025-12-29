import { AIChatModelCard } from '../types/aiModel';

const higressChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: '通义千问超大规模语言模型，支持中文、英文等不同语言输入。',
    displayName: 'Qwen Turbo',
    enabled: true,
    id: 'qwen-turbo',
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
    },
    contextWindowTokens: 131_072,
    description: '通义千问超大规模语言模型增强版，支持中文、英文等不同语言输入。',
    displayName: 'Qwen Plus',
    enabled: true,
    id: 'qwen-plus',
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
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      '通义千问千亿级别超大规模语言模型，支持中文、英文等不同语言输入，当前通义千问2.5产品版本背后的API模型。',
    displayName: 'Qwen Max',
    enabled: true,
    id: 'qwen-max',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 1_000_000,
    description:
      '通义千问超大规模语言模型，支持长文本上下文，以及基于长文档、多文档等多个场景的对话功能。',
    displayName: 'Qwen Long',
    id: 'qwen-long',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      '通义千问大规模视觉语言模型增强版。大幅提升细节识别能力和文字识别能力，支持超百万像素分辨率和任意长宽比规格的图像。',
    displayName: 'Qwen VL Plus',
    enabled: true,
    id: 'qwen-vl-plus-latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      '通义千问超大规模视觉语言模型。相比增强版，再次提升视觉推理能力和指令遵循能力，提供更高的视觉感知和认知水平。',
    displayName: 'Qwen VL Max',
    enabled: true,
    id: 'qwen-vl-max-latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: '通义千问数学模型是专门用于数学解题的语言模型。',
    displayName: 'Qwen Math Turbo',
    id: 'qwen-math-turbo-latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: '通义千问数学模型是专门用于数学解题的语言模型。',
    displayName: 'Qwen Math Plus',
    id: 'qwen-math-plus-latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: '通义千问代码模型。',
    displayName: 'Qwen Coder Turbo',
    id: 'qwen-coder-turbo-latest',
    pricing: {
      currency: 'CNY',
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
    contextWindowTokens: 131_072,
    description: '通义千问2.5对外开源的7B规模的模型。',
    displayName: 'Qwen2.5 7B',
    id: 'qwen2.5-7b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: '通义千问2.5对外开源的14B规模的模型。',
    displayName: 'Qwen2.5 14B',
    id: 'qwen2.5-14b-instruct',
    pricing: {
      currency: 'CNY',
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
    contextWindowTokens: 131_072,
    description: '通义千问2.5对外开源的32B规模的模型。',
    displayName: 'Qwen2.5 32B',
    id: 'qwen2.5-32b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: '通义千问2.5对外开源的72B规模的模型。',
    displayName: 'Qwen2.5 72B',
    id: 'qwen2.5-72b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Qwen-Math 模型具有强大的数学解题能力。',
    displayName: 'Qwen2.5 Math 1.5B',
    id: 'qwen2.5-math-1.5b-instruct',
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
    contextWindowTokens: 4096,
    description: 'Qwen-Math 模型具有强大的数学解题能力。',
    displayName: 'Qwen2.5 Math 7B',
    id: 'qwen2.5-math-7b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Qwen-Math 模型具有强大的数学解题能力。',
    displayName: 'Qwen2.5 Math 72B',
    id: 'qwen2.5-math-72b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: '通义千问代码模型开源版。',
    displayName: 'Qwen2.5 Coder 1.5B',
    id: 'qwen2.5-coder-1.5b-instruct',
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
    contextWindowTokens: 131_072,
    description: '通义千问代码模型开源版。',
    displayName: 'Qwen2.5 Coder 7B',
    id: 'qwen2.5-coder-7b-instruct',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8000,
    description: '以 Qwen-7B 语言模型初始化，添加图像模型，图像输入分辨率为448的预训练模型。',
    displayName: 'Qwen VL',
    id: 'qwen-vl-v1',
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
      vision: true,
    },
    contextWindowTokens: 8000,
    description: '通义千问VL支持灵活的交互方式，包括多图、多轮问答、创作等能力的模型。',
    displayName: 'Qwen VL Chat',
    id: 'qwen-vl-chat-v1',
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
    contextWindowTokens: 8192,
    description:
      'Moonshot V1 8K 专为生成短文本任务设计，具有高效的处理性能，能够处理8,192个tokens，非常适合简短对话、速记和快速内容生成。',
    displayName: 'Moonshot V1 8K',
    enabled: true,
    id: 'moonshot-v1-8k',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Moonshot V1 32K 提供中等长度的上下文处理能力，能够处理32,768个tokens，特别适合生成各种长文档和复杂对话，应用于内容创作、报告生成和对话系统等领域。',
    displayName: 'Moonshot V1 32K',
    enabled: true,
    id: 'moonshot-v1-32k',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Moonshot V1 128K 是一款拥有超长上下文处理能力的模型，适用于生成超长文本，满足复杂的生成任务需求，能够处理多达128,000个tokens的内容，非常适合科研、学术和大型文档生成等应用场景。',
    displayName: 'Moonshot V1 128K',
    enabled: true,
    id: 'moonshot-v1-128k',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      '模型能力国内第一，在知识百科、长文本、生成创作等中文任务上超越国外主流模型。还具备行业领先的多模态能力，多项权威评测基准表现优异。',
    displayName: 'Baichuan 4',
    enabled: true,
    id: 'Baichuan4',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    description: '',
    displayName: 'Baichuan 4 Turbo',
    enabled: true,
    id: 'Baichuan4-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    description: '',
    displayName: 'Baichuan 4 Air',
    enabled: true,
    id: 'Baichuan4-Air',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      '针对企业高频场景优化，效果大幅提升，高性价比。相对于Baichuan2模型，内容创作提升20%，知识问答提升17%， 角色扮演能力提升40%。整体效果比GPT3.5更优。',
    displayName: 'Baichuan 3 Turbo',
    enabled: true,
    id: 'Baichuan3-Turbo',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      '具备 128K 超长上下文窗口，针对企业高频场景优化，效果大幅提升，高性价比。相对于Baichuan2模型，内容创作提升20%，知识问答提升17%， 角色扮演能力提升40%。整体效果比GPT3.5更优。',
    displayName: 'Baichuan 3 Turbo 128k',
    enabled: true,
    id: 'Baichuan3-Turbo-128k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      '采用搜索增强技术实现大模型与领域知识、全网知识的全面链接。支持PDF、Word等多种文档上传及网址输入，信息获取及时、全面，输出结果准确、专业。',
    displayName: 'Baichuan 2 Turbo',
    id: 'Baichuan2-Turbo',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: '最新高性能模型，保证高质量输出同时，推理速度大幅提升。',
    displayName: 'Yi Lightning',
    enabled: true,
    id: 'yi-lightning',
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
    contextWindowTokens: 16_384,
    description: '小而精悍，轻量极速模型。提供强化数学运算和代码编写能力。',
    displayName: 'Yi Spark',
    enabled: true,
    id: 'yi-spark',
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
    contextWindowTokens: 16_384,
    description: '中型尺寸模型升级微调，能力均衡，性价比高。深度优化指令遵循能力。',
    displayName: 'Yi Medium',
    enabled: true,
    id: 'yi-medium',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 200_000,
    description: '200K 超长上下文窗口，提供长文本深度理解和生成能力。',
    displayName: 'Yi Medium 200K',
    enabled: true,
    id: 'yi-medium-200k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: '超高性价比、卓越性能。根据性能和推理速度、成本，进行平衡性高精度调优。',
    displayName: 'Yi Large Turbo',
    enabled: true,
    id: 'yi-large-turbo',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      '基于 yi-large 超强模型的高阶服务，结合检索与生成技术提供精准答案，实时全网检索信息服务。',
    displayName: 'Yi Large RAG',
    enabled: true,
    id: 'yi-large-rag',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
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
      '在 yi-large 模型的基础上支持并强化了工具调用的能力，适用于各种需要搭建 agent 或 workflow 的业务场景。',
    displayName: 'Yi Large FC',
    enabled: true,
    id: 'yi-large-fc',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: '全新千亿参数模型，提供超强问答及文本生成能力。',
    displayName: 'Yi Large',
    id: 'yi-large',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_384,
    description: '复杂视觉任务模型，提供高性能图片理解、分析能力。',
    displayName: 'Yi Vision',
    enabled: true,
    id: 'yi-vision',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: '初期版本，推荐使用 yi-large（新版本）。',
    displayName: 'Yi Large Preview',
    id: 'yi-large-preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: '轻量化版本，推荐使用 yi-lightning。',
    displayName: 'Yi Lightning Lite',
    id: 'yi-lightning-lite',
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
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'GLM-4-Flash 是处理简单任务的理想选择，速度最快且免费。',
    displayName: 'GLM-4-Flash',
    enabled: true,
    id: 'glm-4-flash',
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
    contextWindowTokens: 128_000,
    description: 'GLM-4-FlashX 是Flash的增强版本，超快推理速度。',
    displayName: 'GLM-4-FlashX',
    enabled: true,
    id: 'glm-4-flashx',
    pricing: {
      currency: 'CNY',
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
    contextWindowTokens: 1_024_000,
    description: 'GLM-4-Long 支持超长文本输入，适合记忆型任务与大规模文档处理。',
    displayName: 'GLM-4-Long',
    id: 'glm-4-long',
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
    contextWindowTokens: 128_000,
    description: 'GLM-4-Air 是性价比高的版本，性能接近GLM-4，提供快速度和实惠的价格。',
    displayName: 'GLM-4-Air',
    enabled: true,
    id: 'glm-4-air',
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
    contextWindowTokens: 8192,
    description: 'GLM-4-AirX 提供 GLM-4-Air 的高效版本，推理速度可达其2.6倍。',
    displayName: 'GLM-4-AirX',
    enabled: true,
    id: 'glm-4-airx',
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
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GLM-4-AllTools 是一个多功能智能体模型，优化以支持复杂指令规划与工具调用，如网络浏览、代码解释和文本生成，适用于多任务执行。',
    displayName: 'GLM-4-AllTools',
    id: 'glm-4-alltools',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'GLM-4-Plus 作为高智能旗舰，具备强大的处理长文本和复杂任务的能力，性能全面提升。',
    displayName: 'GLM-4-Plus',
    enabled: true,
    id: 'glm-4-plus',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'GLM-4-0520 是最新模型版本，专为高度复杂和多样化任务设计，表现卓越。',
    displayName: 'GLM-4-0520',
    id: 'glm-4-0520',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'GLM-4 是发布于2024年1月的旧旗舰版本，目前已被更强的 GLM-4-0520 取代。',
    displayName: 'GLM-4',
    id: 'glm-4',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description: 'GLM-4V-Plus 具备对视频内容及多图片的理解能力，适合多模态任务。',
    displayName: 'GLM-4V-Plus',
    enabled: true,
    id: 'glm-4v-plus',
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
    contextWindowTokens: 2048,
    description: 'GLM-4V 提供强大的图像理解与推理能力，支持多种视觉任务。',
    displayName: 'GLM-4V',
    id: 'glm-4v',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'CharGLM-3 专为角色扮演与情感陪伴设计，支持超长多轮记忆与个性化对话，应用广泛。',
    displayName: 'CharGLM-3',
    id: 'charglm-3',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Emohaa 是心理模型，具备专业咨询能力，帮助用户理解情感问题。',
    displayName: 'Emohaa',
    id: 'emohaa',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      '360GPT2 Pro 是 360 公司推出的高级自然语言处理模型，具备卓越的文本生成和理解能力，尤其在生成与创作领域表现出色，能够处理复杂的语言转换和角色演绎任务。',
    displayName: '360GPT2 Pro',
    enabled: true,
    id: '360gpt2-pro',
    maxOutput: 7000,
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
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      '360GPT Pro 作为 360 AI 模型系列的重要成员，以高效的文本处理能力满足多样化的自然语言应用场景，支持长文本理解和多轮对话等功能。',
    displayName: '360GPT Pro',
    enabled: true,
    id: '360gpt-pro',
    maxOutput: 7000,
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
    contextWindowTokens: 8192,
    description:
      '360GPT Turbo 提供强大的计算和对话能力，具备出色的语义理解和生成效率，是企业和开发者理想的智能助理解决方案。',
    displayName: '360GPT Turbo',
    enabled: true,
    id: '360gpt-turbo',
    maxOutput: 7000,
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
    contextWindowTokens: 8192,
    description:
      '360GPT Turbo Responsibility 8K 强调语义安全和责任导向，专为对内容安全有高度要求的应用场景设计，确保用户体验的准确性与稳健性。',
    displayName: '360GPT Turbo Responsibility 8K',
    enabled: true,
    id: '360gpt-turbo-responsibility-8k',
    maxOutput: 2048,
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
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级大规模⼤语⾔模型，覆盖海量中英文语料，具有强大的通用能力，可满足绝大部分对话问答、创作生成、插件应用场景要求；支持自动对接百度搜索插件，保障问答信息时效。',
    displayName: 'ERNIE 3.5 8K',
    enabled: true,
    id: 'ERNIE-3.5-8K',
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
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级大规模⼤语⾔模型，覆盖海量中英文语料，具有强大的通用能力，可满足绝大部分对话问答、创作生成、插件应用场景要求；支持自动对接百度搜索插件，保障问答信息时效。',
    displayName: 'ERNIE 3.5 8K Preview',
    id: 'ERNIE-3.5-8K-Preview',
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
    contextWindowTokens: 128_000,
    description:
      '百度自研的旗舰级大规模⼤语⾔模型，覆盖海量中英文语料，具有强大的通用能力，可满足绝大部分对话问答、创作生成、插件应用场景要求；支持自动对接百度搜索插件，保障问答信息时效。',
    displayName: 'ERNIE 3.5 128K',
    enabled: true,
    id: 'ERNIE-3.5-128K',
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
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级超大规模⼤语⾔模型，相较ERNIE 3.5实现了模型能力全面升级，广泛适用于各领域复杂任务场景；支持自动对接百度搜索插件，保障问答信息时效。',
    displayName: 'ERNIE 4.0 8K',
    enabled: true,
    id: 'ERNIE-4.0-8K-Latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 90, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级超大规模⼤语⾔模型，相较ERNIE 3.5实现了模型能力全面升级，广泛适用于各领域复杂任务场景；支持自动对接百度搜索插件，保障问答信息时效。',
    displayName: 'ERNIE 4.0 8K Preview',
    id: 'ERNIE-4.0-8K-Preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 90, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级超大规模⼤语⾔模型，综合效果表现出色，广泛适用于各领域复杂任务场景；支持自动对接百度搜索插件，保障问答信息时效。相较于ERNIE 4.0在性能表现上更优秀',
    displayName: 'ERNIE 4.0 Turbo 8K',
    enabled: true,
    id: 'ERNIE-4.0-Turbo-8K-Latest',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      '百度自研的旗舰级超大规模⼤语⾔模型，综合效果表现出色，广泛适用于各领域复杂任务场景；支持自动对接百度搜索插件，保障问答信息时效。相较于ERNIE 4.0在性能表现上更优秀',
    displayName: 'ERNIE 4.0 Turbo 8K Preview',
    id: 'ERNIE-4.0-Turbo-8K-Preview',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      '百度自研的轻量级大语言模型，兼顾优异的模型效果与推理性能，效果比ERNIE Lite更优，适合低算力AI加速卡推理使用。',
    displayName: 'ERNIE Lite Pro 128K',
    enabled: true,
    id: 'ERNIE-Lite-Pro-128K',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      '百度2024年最新发布的自研高性能大语言模型，通用能力优异，效果比ERNIE Speed更优，适合作为基座模型进行精调，更好地处理特定场景问题，同时具备极佳的推理性能。',
    displayName: 'ERNIE Speed Pro 128K',
    enabled: true,
    id: 'ERNIE-Speed-Pro-128K',
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
    contextWindowTokens: 128_000,
    description:
      '百度2024年最新发布的自研高性能大语言模型，通用能力优异，适合作为基座模型进行精调，更好地处理特定场景问题，同时具备极佳的推理性能。',
    displayName: 'ERNIE Speed 128K',
    id: 'ERNIE-Speed-128K',
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
    contextWindowTokens: 8192,
    description:
      '百度自研的垂直场景大语言模型，适合游戏NPC、客服对话、对话角色扮演等应用场景，人设风格更为鲜明、一致，指令遵循能力更强，推理性能更优。',
    displayName: 'ERNIE Character 8K',
    id: 'ERNIE-Character-8K',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      '升级为 MOE 结构，上下文窗口为 256k ，在 NLP，代码，数学，行业等多项评测集上领先众多开源模型。',
    displayName: 'Hunyuan Lite',
    enabled: true,
    id: 'hunyuan-lite',
    maxOutput: 6000,
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
    contextWindowTokens: 32_000,
    description:
      '采用更优的路由策略，同时缓解了负载均衡和专家趋同的问题。长文方面，大海捞针指标达到99.9%。MOE-32K 性价比相对更高，在平衡效果、价格的同时，可对实现对长文本输入的处理。',
    displayName: 'Hunyuan Standard',
    enabled: true,
    id: 'hunyuan-standard',
    maxOutput: 2000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      '采用更优的路由策略，同时缓解了负载均衡和专家趋同的问题。长文方面，大海捞针指标达到99.9%。MOE-256K 在长度和效果上进一步突破，极大的扩展了可输入长度。',
    displayName: 'Hunyuan Standard 256K',
    enabled: true,
    id: 'hunyuan-standard-256K',
    maxOutput: 6000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
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
      '混元全新一代大语言模型的预览版，采用全新的混合专家模型（MoE）结构，相比hunyuan-pro推理效率更快，效果表现更强。',
    displayName: 'Hunyuan Turbo',
    enabled: true,
    id: 'hunyuan-turbo',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
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
      '万亿级参数规模 MOE-32K 长文模型。在各种 benchmark 上达到绝对领先的水平，复杂指令和推理，具备复杂数学能力，支持 functioncall，在多语言翻译、金融法律医疗等领域应用重点优化。',
    displayName: 'Hunyuan Pro',
    enabled: true,
    id: 'hunyuan-pro',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 100, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    description: '',
    displayName: 'Hunyuan Large',
    enabled: true,
    id: 'hunyuan-large',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8000,
    description: '混元最新多模态模型，支持图片+文本输入生成文本内容。',
    displayName: 'Hunyuan Vision',
    enabled: true,
    id: 'hunyuan-vision',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 18, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      '混元最新代码生成模型，经过 200B 高质量代码数据增训基座模型，迭代半年高质量 SFT 数据训练，上下文长窗口长度增大到 8K，五大语言代码生成自动评测指标上位居前列；五大语言10项考量各方面综合代码任务人工高质量评测上，性能处于第一梯队',
    displayName: 'Hunyuan Code',
    id: 'hunyuan-code',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      '混元最新 MOE 架构 FunctionCall 模型，经过高质量的 FunctionCall 数据训练，上下文窗口达 32K，在多个维度的评测指标上处于领先。',
    displayName: 'Hunyuan FunctionCall',
    id: 'hunyuan-functioncall',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      '混元最新版角色扮演模型，混元官方精调训练推出的角色扮演模型，基于混元模型结合角色扮演场景数据集进行增训，在角色扮演场景具有更好的基础效果。',
    displayName: 'Hunyuan Role',
    id: 'hunyuan-role',
    maxOutput: 4000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8000,
    description: '高速模型，适合实时对话。',
    displayName: 'Step 1 Flash',
    enabled: true,
    id: 'step-1-flash',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8000,
    description: '小型模型，适合轻量级任务。',
    displayName: 'Step 1 8K',
    enabled: true,
    id: 'step-1-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description: '支持中等长度的对话，适用于多种应用场景。',
    displayName: 'Step 1 32K',
    enabled: true,
    id: 'step-1-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 70, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: '平衡性能与成本，适合一般场景。',
    displayName: 'Step 1 128K',
    enabled: true,
    id: 'step-1-128k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 200, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 256_000,
    description: '具备超长上下文处理能力，尤其适合长文档分析。',
    displayName: 'Step 1 256K',
    id: 'step-1-256k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 300, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_000,
    description: '支持大规模上下文交互，适合复杂对话场景。',
    displayName: 'Step 2 16K',
    enabled: true,
    id: 'step-2-16k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 38, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 8000,
    description: '小型视觉模型，适合基本的图文任务。',
    displayName: 'Step 1V 8K',
    enabled: true,
    id: 'step-1v-8k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 32_000,
    description: '支持视觉输入，增强多模态交互体验。',
    displayName: 'Step 1V 32K',
    enabled: true,
    id: 'step-1v-32k',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 70, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description: '该模型拥有强大的视频理解能力。',
    displayName: 'Step 1.5V Mini',
    enabled: true,
    id: 'step-1.5v-mini',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 35, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Lite 是一款轻量级大语言模型，具备极低的延迟与高效的处理能力，完全免费开放，支持实时在线搜索功能。其快速响应的特性使其在低算力设备上的推理应用和模型微调中表现出色，为用户带来出色的成本效益和智能体验，尤其在知识问答、内容生成及搜索场景下表现不俗。',
    displayName: 'Spark Lite',
    enabled: true,
    id: 'lite',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Pro 是一款为专业领域优化的高性能大语言模型，专注数学、编程、医疗、教育等多个领域，并支持联网搜索及内置天气、日期等插件。其优化后模型在复杂知识问答、语言理解及高层次文本创作中展现出色表现和高效性能，是适合专业应用场景的理想选择。',
    displayName: 'Spark Pro',
    enabled: true,
    id: 'generalv3',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Spark Pro 128K 配置了特大上下文处理能力，能够处理多达128K的上下文信息，特别适合需通篇分析和长期逻辑关联处理的长文内容，可在复杂文本沟通中提供流畅一致的逻辑与多样的引用支持。',
    displayName: 'Spark Pro 128K',
    enabled: true,
    id: 'pro-128k',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Max 为功能最为全面的版本，支持联网搜索及众多内置插件。其全面优化的核心能力以及系统角色设定和函数调用功能，使其在各种复杂应用场景中的表现极为优异和出色。',
    displayName: 'Spark Max',
    enabled: true,
    id: 'generalv3.5',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Spark Max 32K 配置了大上下文处理能力，更强的上下文理解和逻辑推理能力，支持32K tokens的文本输入，适用于长文档阅读、私有知识问答等场景',
    displayName: 'Spark Max 32K',
    enabled: true,
    id: 'max-32k',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Ultra 是星火大模型系列中最为强大的版本，在升级联网搜索链路同时，提升对文本内容的理解和总结能力。它是用于提升办公生产力和准确响应需求的全方位解决方案，是引领行业的智能产品。',
    displayName: 'Spark 4.0 Ultra',
    enabled: true,
    id: '4.0Ultra',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'o1-mini是一款针对编程、数学和科学应用场景而设计的快速、经济高效的推理模型。该模型具有128K上下文和2023年10月的知识截止日期。',
    displayName: 'OpenAI o1-mini',
    enabled: true,
    id: 'o1-mini',
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
    contextWindowTokens: 128_000,
    description:
      'o1是OpenAI新的推理模型，适用于需要广泛通用知识的复杂任务。该模型具有128K上下文和2023年10月的知识截止日期。',
    displayName: 'OpenAI o1-preview',
    enabled: true,
    id: 'o1-preview',
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
    enabled: true,
    id: 'gpt-4o-mini',
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
    enabled: true,
    id: 'gpt-4o',
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o 是一款动态模型，实时更新以保持当前最新版本。它结合了强大的语言理解与生成能力，适合于大规模应用场景，包括客户服务、教育和技术支持。',
    displayName: 'GPT-4o 0806',
    id: 'gpt-4o-2024-08-06',
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o 是一款动态模型，实时更新以保持当前最新版本。它结合了强大的语言理解与生成能力，适合于大规模应用场景，包括客户服务、教育和技术支持。',
    displayName: 'GPT-4o 0513',
    id: 'gpt-4o-2024-05-13',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'ChatGPT-4o 是一款动态模型，实时更新以保持当前最新版本。它结合了强大的语言理解与生成能力，适合于大规模应用场景，包括客户服务、教育和技术支持。',
    displayName: 'ChatGPT-4o',
    enabled: true,
    id: 'chatgpt-4o-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 128_000,
    description:
      '最新的 GPT-4 Turbo 模型具备视觉功能。现在，视觉请求可以使用 JSON 模式和函数调用。 GPT-4 Turbo 是一个增强版本，为多模态任务提供成本效益高的支持。它在准确性和效率之间找到平衡，适合需要进行实时交互的应用程序场景。',
    displayName: 'GPT-4 Turbo',
    id: 'gpt-4-turbo',
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
    contextWindowTokens: 128_000,
    description:
      '最新的 GPT-4 Turbo 模型具备视觉功能。现在，视觉请求可以使用 JSON 模式和函数调用。 GPT-4 Turbo 是一个增强版本，为多模态任务提供成本效益高的支持。它在准确性和效率之间找到平衡，适合需要进行实时交互的应用程序场景。',
    displayName: 'GPT-4 Turbo Vision 0409',
    id: 'gpt-4-turbo-2024-04-09',
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
    },
    contextWindowTokens: 128_000,
    description:
      '最新的 GPT-4 Turbo 模型具备视觉功能。现在，视觉请求可以使用 JSON 模式和函数调用。 GPT-4 Turbo 是一个增强版本，为多模态任务提供成本效益高的支持。它在准确性和效率之间找到平衡，适合需要进行实时交互的应用程序场景。',
    displayName: 'GPT-4 Turbo Preview',
    id: 'gpt-4-turbo-preview',
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
    },
    contextWindowTokens: 128_000,
    description:
      '最新的 GPT-4 Turbo 模型具备视觉功能。现在，视觉请求可以使用 JSON 模式和函数调用。 GPT-4 Turbo 是一个增强版本，为多模态任务提供成本效益高的支持。它在准确性和效率之间找到平衡，适合需要进行实时交互的应用程序场景。',
    displayName: 'GPT-4 Turbo Preview 0125',
    id: 'gpt-4-0125-preview',
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
    },
    contextWindowTokens: 128_000,
    description:
      '最新的 GPT-4 Turbo 模型具备视觉功能。现在，视觉请求可以使用 JSON 模式和函数调用。 GPT-4 Turbo 是一个增强版本，为多模态任务提供成本效益高的支持。它在准确性和效率之间找到平衡，适合需要进行实时交互的应用程序场景。',
    displayName: 'GPT-4 Turbo Preview 1106',
    id: 'gpt-4-1106-preview',
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
    },
    contextWindowTokens: 8192,
    description:
      'GPT-4 提供了一个更大的上下文窗口，能够处理更长的文本输入，适用于需要广泛信息整合和数据分析的场景。',
    displayName: 'GPT-4',
    id: 'gpt-4',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description:
      'GPT-4 提供了一个更大的上下文窗口，能够处理更长的文本输入，适用于需要广泛信息整合和数据分析的场景。',
    displayName: 'GPT-4 0613',
    id: 'gpt-4-0613',
    pricing: {
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT-4 提供了一个更大的上下文窗口，能够处理更长的文本输入，适用于需要广泛信息整合和数据分析的场景。',
    displayName: 'GPT-4 32K',
    id: 'gpt-4-32k',
    pricing: {
      units: [
        { name: 'textInput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT-4 提供了一个更大的上下文窗口，能够处理更长的文本输入，适用于需要广泛信息整合和数据分析的场景。',
    displayName: 'GPT-4 32K 0613',
    id: 'gpt-4-32k-0613',
    pricing: {
      units: [
        { name: 'textInput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
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
      'GPT 3.5 Turbo，适用于各种文本生成和理解任务，Currently points to gpt-3.5-turbo-0125',
    displayName: 'GPT-3.5 Turbo',
    id: 'gpt-3.5-turbo',
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
    contextWindowTokens: 16_385,
    description:
      'GPT 3.5 Turbo，适用于各种文本生成和理解任务，Currently points to gpt-3.5-turbo-0125',
    displayName: 'GPT-3.5 Turbo 0125',
    id: 'gpt-3.5-turbo-0125',
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
    contextWindowTokens: 16_385,
    description:
      'GPT 3.5 Turbo，适用于各种文本生成和理解任务，Currently points to gpt-3.5-turbo-0125',
    displayName: 'GPT-3.5 Turbo 1106',
    id: 'gpt-3.5-turbo-1106',
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'GPT 3.5 Turbo，适用于各种文本生成和理解任务，Currently points to gpt-3.5-turbo-0125',
    displayName: 'GPT-3.5 Turbo Instruct',
    id: 'gpt-3.5-turbo-instruct',
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
    contextWindowTokens: 16_385,
    description:
      'GPT 3.5 Turbo，OpenAI提供的高效模型，适用于聊天和文本生成任务，支持并行函数调用。',
    displayName: 'GPT 3.5 Turbo',
    enabled: true,
    id: 'gpt-35-turbo',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_384,
    description: 'GPT 3.5 Turbo 16k，高容量文本生成模型，适合复杂任务。',
    displayName: 'GPT 3.5 Turbo',
    id: 'gpt-35-turbo-16k',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT 4 Turbo，多模态模型，提供杰出的语言理解和生成能力，同时支持图像输入。',
    displayName: 'GPT 4 Turbo',
    enabled: true,
    id: 'gpt-4',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4 视觉预览版，专为图像分析和处理任务设计。',
    displayName: 'GPT 4 Turbo with Vision Preview',
    id: 'gpt-4-vision-preview',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o Mini，小型高效模型，具备与GPT-4o相似的卓越性能。',
    displayName: 'GPT 4o Mini',
    enabled: true,
    id: 'gpt-4o-mini',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'GPT-4o 是最新的多模态模型，结合高级文本和图像处理能力。',
    displayName: 'GPT 4o',
    enabled: true,
    id: 'gpt-4o',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: '比 o1-preview 更小、更快，成本低80%，在代码生成和小上下文操作方面表现良好。',
    displayName: 'OpenAI o1-mini',
    enabled: true,
    id: 'o1-mini',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      '专注于高级推理和解决复杂问题，包括数学和科学任务。非常适合需要深度上下文理解和自主工作流程的应用。',
    displayName: 'OpenAI o1-preview',
    enabled: true,
    id: 'o1-preview',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: '一种经济高效的AI解决方案，适用于多种文本和图像任务。',
    displayName: 'OpenAI GPT-4o mini',
    enabled: true,
    id: 'gpt-4o-mini',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description: 'OpenAI GPT-4系列中最先进的多模态模型，可以处理文本和图像输入。',
    displayName: 'OpenAI GPT-4o',
    enabled: true,
    id: 'gpt-4o',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      '一个52B参数（12B活跃）的多语言模型，提供256K长上下文窗口、函数调用、结构化输出和基于事实的生成。',
    displayName: 'AI21 Jamba 1.5 Mini',
    id: 'ai21-jamba-1.5-mini',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      '一个398B参数（94B活跃）的多语言模型，提供256K长上下文窗口、函数调用、结构化输出和基于事实的生成。',
    displayName: 'AI21 Jamba 1.5 Large',
    id: 'ai21-jamba-1.5-large',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Command R是一个可扩展的生成模型，旨在针对RAG和工具使用，使企业能够实现生产级AI。',
    displayName: 'Cohere Command R',
    id: 'cohere-command-r',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Command R+是一个最先进的RAG优化模型，旨在应对企业级工作负载。',
    displayName: 'Cohere Command R+',
    id: 'cohere-command-r-plus',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral Nemo是一种尖端的语言模型（LLM），在其尺寸类别中拥有最先进的推理、世界知识和编码能力。',
    displayName: 'Mistral Nemo',
    id: 'mistral-nemo',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Mistral Small可用于任何需要高效率和低延迟的基于语言的任务。',
    displayName: 'Mistral Small',
    id: 'mistral-small',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral的旗舰模型，适合需要大规模推理能力或高度专业化的复杂任务（合成文本生成、代码生成、RAG或代理）。',
    displayName: 'Mistral Large',
    id: 'mistral-large',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: '在高分辨率图像上表现出色的图像推理能力，适用于视觉理解应用。',
    displayName: 'Llama 3.2 11B Vision',
    id: 'llama-3.2-11b-vision-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: '适用于视觉理解代理应用的高级图像推理能力。',
    displayName: 'Llama 3.2 90B Vision',
    id: 'llama-3.2-90b-vision-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1指令调优的文本模型，针对多语言对话用例进行了优化，在许多可用的开源和封闭聊天模型中，在常见行业基准上表现优异。',
    displayName: 'Meta Llama 3.1 8B',
    id: 'meta-llama-3.1-8b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1指令调优的文本模型，针对多语言对话用例进行了优化，在许多可用的开源和封闭聊天模型中，在常见行业基准上表现优异。',
    displayName: 'Meta Llama 3.1 70B',
    id: 'meta-llama-3.1-70b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1指令调优的文本模型，针对多语言对话用例进行了优化，在许多可用的开源和封闭聊天模型中，在常见行业基准上表现优异。',
    displayName: 'Meta Llama 3.1 405B',
    id: 'meta-llama-3.1-405b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: '一个多功能的80亿参数模型，针对对话和文本生成任务进行了优化。',
    displayName: 'Meta Llama 3 8B',
    id: 'meta-llama-3-8b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: '一个强大的700亿参数模型，在推理、编码和广泛的语言应用方面表现出色。',
    displayName: 'Meta Llama 3 70B',
    id: 'meta-llama-3-70b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Phi-3-mini模型的更新版。',
    displayName: 'Phi-3.5-mini 128K',
    id: 'Phi-3.5-mini-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description: 'Phi-3-vision模型的更新版。',
    displayName: 'Phi-3.5-vision 128K',
    id: 'Phi-3.5-vision-instrust',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'Phi-3家族中最小的成员，针对质量和低延迟进行了优化。',
    displayName: 'Phi-3-mini 4K',
    id: 'Phi-3-mini-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: '相同的Phi-3-mini模型，但具有更大的上下文大小，适用于RAG或少量提示。',
    displayName: 'Phi-3-mini 128K',
    id: 'Phi-3-mini-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: '一个70亿参数模型，质量优于Phi-3-mini，重点关注高质量、推理密集型数据。',
    displayName: 'Phi-3-small 8K',
    id: 'Phi-3-small-8k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: '相同的Phi-3-small模型，但具有更大的上下文大小，适用于RAG或少量提示。',
    displayName: 'Phi-3-small 128K',
    id: 'Phi-3-small-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: '一个140亿参数模型，质量优于Phi-3-mini，重点关注高质量、推理密集型数据。',
    displayName: 'Phi-3-medium 4K',
    id: 'Phi-3-medium-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: '相同的Phi-3-medium模型，但具有更大的上下文大小，适用于RAG或少量提示。',
    displayName: 'Phi-3-medium 128K',
    id: 'Phi-3-medium-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'Llama 3.2 旨在处理结合视觉和文本数据的任务。它在图像描述和视觉问答等任务中表现出色，跨越了语言生成和视觉推理之间的鸿沟。',
    displayName: 'Llama 3.2 11B Vision (Preview)',
    enabled: true,
    id: 'llama-3.2-11b-vision-preview',
    maxOutput: 8192,
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
      vision: true,
    },
    contextWindowTokens: 8192,
    description:
      'Llama 3.2 旨在处理结合视觉和文本数据的任务。它在图像描述和视觉问答等任务中表现出色，跨越了语言生成和视觉推理之间的鸿沟。',
    displayName: 'Llama 3.2 90B Vision (Preview)',
    enabled: true,
    id: 'llama-3.2-90b-vision-preview',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
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
      'Llama 3.1 8B 是一款高效能模型，提供了快速的文本生成能力，非常适合需要大规模效率和成本效益的应用场景。',
    displayName: 'Llama 3.1 8B',
    enabled: true,
    id: 'llama-3.1-8b-instant',
    maxOutput: 8192,
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
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 70B 提供更强大的AI推理能力，适合复杂应用，支持超多的计算处理并保证高效和准确率。',
    displayName: 'Llama 3.1 70B',
    enabled: true,
    id: 'llama-3.1-70b-versatile',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Llama 3 Groq 8B Tool Use 是针对高效工具使用优化的模型，支持快速并行计算。',
    displayName: 'Llama 3 Groq 8B Tool Use (Preview)',
    id: 'llama3-groq-8b-8192-tool-use-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.19, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Llama 3 Groq 70B Tool Use 提供强大的工具调用能力，支持复杂任务的高效处理。',
    displayName: 'Llama 3 Groq 70B Tool Use (Preview)',
    id: 'llama3-groq-70b-8192-tool-use-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.89, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.89, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Meta Llama 3 8B 带来优质的推理效能，适合多场景应用需求。',
    displayName: 'Meta Llama 3 8B',
    id: 'llama3-8b-8192',
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
    },
    contextWindowTokens: 8192,
    description: 'Meta Llama 3 70B 提供无与伦比的复杂性处理能力，为高要求项目量身定制。',
    displayName: 'Meta Llama 3 70B',
    id: 'llama3-70b-8192',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.59, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.79, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Gemma 2 9B 是一款优化用于特定任务和工具整合的模型。',
    displayName: 'Gemma 2 9B',
    enabled: true,
    id: 'gemma2-9b-it',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Gemma 7B 适合中小规模任务处理，兼具成本效益。',
    displayName: 'Gemma 7B',
    id: 'gemma-7b-it',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description: 'Mixtral 8x7B 提供高容错的并行计算能力，适合复杂任务。',
    displayName: 'Mixtral 8x7B',
    id: 'mixtral-8x7b-32768',
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
      vision: true,
    },
    contextWindowTokens: 4096,
    description: 'LLaVA 1.5 7B 提供视觉处理能力融合，通过视觉信息输入生成复杂输出。',
    displayName: 'LLaVA 1.5 7B',
    id: 'llava-v1.5-7b-4096-preview',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      '融合通用与代码能力的全新开源模型, 不仅保留了原有 Chat 模型的通用对话能力和 Coder 模型的强大代码处理能力，还更好地对齐了人类偏好。此外，DeepSeek-V2.5 在写作任务、指令跟随等多个方面也实现了大幅提升。',
    displayName: 'DeepSeek V2.5',
    enabled: true,
    id: 'deepseek-chat',
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.014, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-05',
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
    enabled: true,
    id: 'claude-3-5-haiku-20241022',
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
      'Claude 3 Haiku 是 Anthropic 的最快且最紧凑的模型，旨在实现近乎即时的响应。它具有快速且准确的定向性能。',
    displayName: 'Claude 3 Haiku',
    id: 'claude-3-haiku-20240307',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-03-07',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Sonnet 在智能和速度方面为企业工作负载提供了理想的平衡。它以更低的价格提供最大效用，可靠且适合大规模部署。',
    displayName: 'Claude 3 Sonnet',
    id: 'claude-3-sonnet-20240229',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Opus 是 Anthropic 用于处理高度复杂任务的最强大模型。它在性能、智能、流畅性和理解力方面表现卓越。',
    displayName: 'Claude 3 Opus',
    enabled: true,
    id: 'claude-3-opus-20240229',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-02-29',
    type: 'chat',
  },
  {
    contextWindowTokens: 200_000,
    description:
      'Claude 2 为企业提供了关键能力的进步，包括业界领先的 200K token 上下文、大幅降低模型幻觉的发生率、系统提示以及一个新的测试功能：工具调用。',
    displayName: 'Claude 2.1',
    id: 'claude-2.1',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-11-21',
    type: 'chat',
  },
  {
    contextWindowTokens: 100_000,
    description:
      'Claude 2 为企业提供了关键能力的进步，包括业界领先的 200K token 上下文、大幅降低模型幻觉的发生率、系统提示以及一个新的测试功能：工具调用。',
    displayName: 'Claude 2.0',
    id: 'claude-2.0',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-07-11',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Nemo是一个与Nvidia合作开发的12B模型，提供出色的推理和编码性能，易于集成和替换。',
    displayName: 'Mistral Nemo',
    enabled: true,
    id: 'open-mistral-nemo',
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
    },
    contextWindowTokens: 128_000,
    description: 'Mistral Small是成本效益高、快速且可靠的选项，适用于翻译、摘要和情感分析等用例。',
    displayName: 'Mistral Small',
    enabled: true,
    id: 'mistral-small-latest',
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
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Large是旗舰大模型，擅长多语言任务、复杂推理和代码生成，是高端应用的理想选择。',
    displayName: 'Mistral Large',
    enabled: true,
    id: 'mistral-large-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Codestral是专注于代码生成的尖端生成模型，优化了中间填充和代码补全任务。',
    displayName: 'Codestral',
    id: 'codestral-latest',
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
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Pixtral 模型在图表和图理解、文档问答、多模态推理和指令遵循等任务上表现出强大的能力，能够以自然分辨率和宽高比摄入图像，还能够在长达 128K 令牌的长上下文窗口中处理任意数量的图像。',
    displayName: 'Pixtral 12B',
    enabled: true,
    id: 'pixtral-12b-2409',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description: 'Ministral 3B 是Mistral的世界顶级边缘模型。',
    displayName: 'Ministral 3B',
    id: 'ministral-3b-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.04, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description: 'Ministral 8B 是Mistral的性价比极高的边缘模型。',
    displayName: 'Ministral 8B',
    id: 'ministral-8b-latest',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mistral 7B是一款紧凑但高性能的模型，擅长批量处理和简单任务，如分类和文本生成，具有良好的推理能力。',
    displayName: 'Mistral 7B',
    id: 'open-mistral-7b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mixtral 8x7B是一个稀疏专家模型，利用多个参数提高推理速度，适合处理多语言和代码生成任务。',
    displayName: 'Mixtral 8x7B',
    id: 'open-mixtral-8x7b',
    pricing: {
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
    contextWindowTokens: 65_536,
    description:
      'Mixtral 8x22B是一个更大的专家模型，专注于复杂任务，提供出色的推理能力和更高的吞吐量。',
    displayName: 'Mixtral 8x22B',
    id: 'open-mixtral-8x22b',
    pricing: {
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 256_000,
    description:
      'Codestral Mamba是专注于代码生成的Mamba 2语言模型，为先进的代码和推理任务提供强力支持。',
    displayName: 'Codestral Mamba',
    id: 'open-codestral-mamba',
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
    },
    contextWindowTokens: 245_760,
    description: '适用于广泛的自然语言处理任务，包括文本生成、对话系统等。',
    displayName: 'abab6.5s',
    enabled: true,
    id: 'abab6.5s-chat',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: '专为多语种人设对话设计，支持英文及其他多种语言的高质量对话生成。',
    displayName: 'abab6.5g',
    enabled: true,
    id: 'abab6.5g-chat',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: '针对中文人设对话场景优化，提供流畅且符合中文表达习惯的对话生成能力。',
    displayName: 'abab6.5t',
    enabled: true,
    id: 'abab6.5t-chat',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description: '面向生产力场景，支持复杂任务处理和高效文本生成，适用于专业领域应用。',
    displayName: 'abab5.5',
    id: 'abab5.5-chat',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: '专为中文人设对话场景设计，提供高质量的中文对话生成能力，适用于多种应用场景。',
    displayName: 'abab5.5s',
    id: 'abab5.5s-chat',
    type: 'chat',
  },
  {
    description: '',
    displayName: 'command-r',
    id: 'command-r',
    type: 'chat',
  },
  {
    description: '',
    displayName: 'command-r-plus',
    id: 'command-r-plus',
    type: 'chat',
  },
  {
    description: '',
    displayName: 'command-light',
    id: 'command-light',
    type: 'chat',
  },
  {
    description:
      'Doubao-lite拥有极致的响应速度，更好的性价比，为客户不同场景提供更灵活的选择。支持4k上下文窗口的推理和精调。',
    displayName: 'Doubao-lite-4k',
    id: 'Doubao-lite-4k',
    type: 'chat',
  },
  {
    description:
      'Doubao-lite拥有极致的响应速度，更好的性价比，为客户不同场景提供更灵活的选择。支持32k上下文窗口的推理和精调。',
    displayName: 'Doubao-lite-32k',
    id: 'Doubao-lite-32k',
    type: 'chat',
  },
  {
    description:
      'Doubao-lite 拥有极致的响应速度，更好的性价比，为客户不同场景提供更灵活的选择。支持128k上下文窗口的推理和精调。',
    displayName: 'Doubao-lite-128k',
    id: 'Doubao-lite-128k',
    type: 'chat',
  },
  {
    description:
      '效果最好的主力模型，适合处理复杂任务，在参考问答、总结摘要、创作、文本分类、角色扮演等场景都有很好的效果。支持4k上下文窗口的推理和精调。',
    displayName: 'Doubao-pro-4k',
    id: 'Doubao-pro-4k',
    type: 'chat',
  },
  {
    description:
      '效果最好的主力模型，适合处理复杂任务，在参考问答、总结摘要、创作、文本分类、角色扮演等场景都有很好的效果。支持32k上下文窗口的推理和精调。',
    displayName: 'Doubao-pro-32k',
    id: 'Doubao-pro-32k',
    type: 'chat',
  },
  {
    description:
      '效果最好的主力模型，适合处理复杂任务，在参考问答、总结摘要、创作、文本分类、角色扮演等场景都有很好的效果。支持128k上下文窗口的推理和精调。',
    displayName: 'Doubao-pro-128k',
    id: 'Doubao-pro-128k',
    type: 'chat',
  },
  {
    description:
      '云雀（Skylark）第二代模型，Skylark2-pro-character模型具有优秀的角色扮演和聊天能力，擅长根据用户prompt要求扮演不同角色与用户展开聊天，角色风格突出，对话内容自然流畅，适用于构建聊天机器人、虚拟助手和在线客服等场景，有较高的响应速度。',
    displayName: 'Skylark2-pro-character-4k',
    id: 'Skylark2-pro-character-4k',
    type: 'chat',
  },
  {
    description:
      '云雀（Skylark）第二代模型，Skylark2-pro版本有较高的模型精度，适用于较为复杂的文本生成场景，如专业领域文案生成、小说创作、高质量翻译等，上下文窗口长度为32k。',
    displayName: 'Skylark2-pro-32k',
    id: 'Skylark2-pro-32k',
    type: 'chat',
  },
  {
    description:
      '云雀（Skylark）第二代模型，Skylark2-pro模型有较高的模型精度，适用于较为复杂的文本生成场景，如专业领域文案生成、小说创作、高质量翻译等，上下文窗口长度为4k。',
    displayName: 'Skylark2-pro-4k',
    id: 'Skylark2-pro-4k',
    type: 'chat',
  },
  {
    description:
      '云雀（Skylark）第二代模型，Skylark2-pro-turbo-8k推理更快，成本更低，上下文窗口长度为8k。',
    displayName: 'Skylark2-pro-turbo-8k',
    id: 'Skylark2-pro-turbo-8k',
    type: 'chat',
  },
  {
    description:
      '云雀（Skylark）第二代模型，Skylark2-lite模型有较高的响应速度，适用于实时性要求高、成本敏感、对模型精度要求不高的场景，上下文窗口长度为8k。',
    displayName: 'Skylark2-lite-8k',
    id: 'Skylark2-lite-8k',
    type: 'chat',
  },
];

export const allModels = [...higressChatModels];

export default allModels;
