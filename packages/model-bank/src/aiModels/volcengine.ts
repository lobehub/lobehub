import { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://www.volcengine.com/docs/82379/1330310

const doubaoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-code-preview-251028',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-Code 面向 Agentic 编程任务进行了深度优化，支持多模态（文字/图片/视频）与 256k 长上下文，兼容 Anthropic API，适用于编程、视觉理解与 Agent 场景。',
    displayName: 'Doubao Seed Code',
    id: 'doubao-seed-code',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.2,
              '[0.032, 0.128]': 1.4,
              '[0.128, 0.256]': 2.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 12,
              '[0.128, 0.256]': 16,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.24, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.017, strategy: 'fixed', unit: 'millionTokens' },
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
    config: {
      deploymentName: 'deepseek-v3-1-terminus',
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-V3.1 是深度求索全新推出的混合推理模型，支持思考与非思考2种推理模式，较 DeepSeek-R1-0528 思考效率更高。经 Post-Training 优化，Agent 工具使用与智能体任务表现大幅提升。支持 128k 上下文窗口，输出长度支持最大 64k tokens。',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
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
    },
    config: {
      deploymentName: 'kimi-k2-250905',
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi-K2 是一款Moonshot AI推出的具备超强代码和 Agent 能力的 MoE 架构基础模型，总参数 1T，激活参数 32B。在通用知识推理、编程、数学、Agent 等主要类别的基准性能测试中，K2 模型的性能超过其他主流开源模型。',
    displayName: 'Kimi K2',
    id: 'kimi-k2',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
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
    config: {
      deploymentName: 'doubao-seed-1-6-vision-250815',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-vision 视觉深度思考模型，在教育、图像审核、巡检与安防和AI 搜索问答等场景下展现出更强的通用多模态理解和推理能力。支持 256k 上下文窗口，输出长度支持最大 64k tokens。',
    displayName: 'Doubao Seed 1.6 Vision',
    id: 'doubao-seed-1.6-vision',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 2.4,
              '[0.128, infinity]': 4.8,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 16,
              '[0.128, infinity]': 24,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
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
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-thinking-250715',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-thinking模型思考能力大幅强化， 对比Doubao-1.5-thinking-pro，在Coding、Math、 逻辑推理等基础能力上进一步提升， 支持视觉理解。 支持 256k 上下文窗口，输出长度支持最大 16k tokens。',
    displayName: 'Doubao Seed 1.6 Thinking',
    enabled: true,
    id: 'doubao-seed-1.6-thinking',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.2,
              '[0.128, infinity]': 2.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 8,
              '[0.032, 0.128]': 16,
              '[0.128, infinity]': 24,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
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
    config: {
      deploymentName: 'doubao-seed-1-6-251015',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6全新多模态深度思考模型，同时支持auto/thinking/non-thinking三种思考模式。 non-thinking模式下，模型效果对比Doubao-1.5-pro/250115大幅提升。支持 256k 上下文窗口，输出长度支持最大 16k tokens。',
    displayName: 'Doubao Seed 1.6',
    enabled: true,
    id: 'doubao-seed-1.6',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.8,
              '[0.032, 0.128]': 1.2,
              '[0.128, infinity]': 2.4,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 8,
              '[0.032, 0.128]_[0, infinity]': 16,
              '[0.128, infinity]_[0, infinity]': 24,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-lite-251015',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-lite 全新多模态深度思考模型，支持思考程度可调节（reasoning effort），即 Minimal、Low、Medium、High 四种模式，更强性价比，常见任务的最佳选择，上下文窗口至256k。',
    displayName: 'Doubao Seed 1.6 Lite',
    id: 'doubao-seed-1.6-lite',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.3,
              '[0.032, 0.128]': 0.6,
              '[0.128, 0.256]': 1.2,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.6,
              '[0, 0.032]_[0.0002, infinity]': 2.4,
              '[0.032, 0.128]_[0, infinity]': 4,
              '[0.128, 0.256]_[0, infinity]': 12,
            },
            pricingParams: ['textInputRange', 'textOutputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-seed-1-6-flash-250828',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-Seed-1.6-flash推理速度极致的多模态深度思考模型，TPOT仅需10ms； 同时支持文本和视觉理解，文本理解能力超过上一代lite，视觉理解比肩友商pro系列模型。支持 256k 上下文窗口，输出长度支持最大 16k tokens。',
    displayName: 'Doubao Seed 1.6 Flash',
    enabled: true,
    id: 'doubao-seed-1.6-flash',
    maxOutput: 32_000,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 0.15,
              '[0.032, 0.128]': 0.3,
              '[0.128, infinity]': 0.6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 1.5,
              '[0.032, 0.128]': 3,
              '[0.128, infinity]': 6,
            },
            pricingParams: ['textInputRange'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        { name: 'textInput_cacheRead', rate: 0.03, strategy: 'fixed', unit: 'millionTokens' },
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
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-ui-tars-250428',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5-UI-TARS 是一款原生面向图形界面交互（GUI）的Agent模型。通过感知、推理和行动等类人的能力，与 GUI 进行无缝交互。',
    displayName: 'Doubao 1.5 UI TARS',
    id: 'doubao-1.5-ui-tars',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-vision-pro-250428',
    },
    contextWindowTokens: 131_072,
    description:
      '全新视觉深度思考模型，具备更强的通用多模态理解和推理能力，在 59 个公开评测基准中的 37 个上取得 SOTA 表现。',
    displayName: 'Doubao 1.5 Thinking Vision Pro',
    id: 'doubao-1.5-thinking-vision-pro',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-pro-250415',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5全新深度思考模型，在数学、编程、科学推理等专业领域及创意写作等通用任务中表现突出，在AIME 2024、Codeforces、GPQA等多项权威基准上达到或接近业界第一梯队水平。支持128k上下文窗口，16k输出。',
    displayName: 'Doubao 1.5 Thinking Pro',
    id: 'doubao-1.5-thinking-pro',
    maxOutput: 16_000,
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
      reasoning: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-thinking-pro-m-250428',
    },
    contextWindowTokens: 131_072,
    description:
      'Doubao-1.5全新深度思考模型 (m 版本自带原生多模态深度推理能力)，在数学、编程、科学推理等专业领域及创意写作等通用任务中表现突出，在AIME 2024、Codeforces、GPQA等多项权威基准上达到或接近业界第一梯队水平。支持128k上下文窗口，16k输出。',
    displayName: 'Doubao 1.5 Thinking Pro M',
    id: 'doubao-1.5-thinking-pro-m',
    maxOutput: 16_000,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['thinking'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    config: {
      deploymentName: 'deepseek-r1-250528',
    },
    contextWindowTokens: 131_072,
    description:
      '0528最新版本上线，DeepSeek-R1 在后训练阶段大规模使用了强化学习技术，在仅有极少标注数据的情况下，极大提升了模型推理能力。在数学、代码、自然语言推理等任务上，性能比肩 OpenAI o1 正式版。',
    displayName: 'DeepSeek R1',
    id: 'deepseek-r1',
    maxOutput: 16_384,
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
    config: {
      deploymentName: 'deepseek-v3-250324',
    },
    contextWindowTokens: 128_000,
    description:
      'DeepSeek-V3 是一款由深度求索公司自研的MoE模型。DeepSeek-V3 多项评测成绩超越了 Qwen2.5-72B 和 Llama-3.1-405B 等其他开源模型，并在性能上和世界顶尖的闭源模型 GPT-4o 以及 Claude-3.5-Sonnet 不分伯仲。',
    displayName: 'DeepSeek V3',
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
    },
    config: {
      deploymentName: 'doubao-1-5-pro-32k-250115',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-pro 全新一代主力模型，性能全面升级，在知识、代码、推理、等方面表现卓越。',
    displayName: 'Doubao 1.5 Pro 32k',
    id: 'doubao-1.5-pro-32k',
    maxOutput: 16_384,
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
    config: {
      deploymentName: 'doubao-1-5-pro-256k-250115',
    },
    contextWindowTokens: 256_000,
    description:
      'Doubao-1.5-pro-256k 基于 Doubao-1.5-Pro 全面升级版，整体效果大幅提升 10%。支持 256k 上下文窗口的推理，输出长度支持最大 12k tokens。更高性能、更大窗口、超高性价比，适用于更广泛的应用场景。',
    displayName: 'Doubao 1.5 Pro 256k',
    id: 'doubao-1.5-pro-256k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    config: {
      deploymentName: 'doubao-1-5-lite-32k-250115',
    },
    contextWindowTokens: 32_768,
    description: 'Doubao-1.5-lite 全新一代轻量版模型，极致响应速度，效果与时延均达到全球一流水平。',
    displayName: 'Doubao 1.5 Lite 32k',
    id: 'doubao-1.5-lite-32k',
    maxOutput: 12_288,
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
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-pro-32k-250115',
    },
    contextWindowTokens: 32_768,
    description:
      'Doubao-1.5-vision-pro 全新升级的多模态大模型，支持任意分辨率和极端长宽比图像识别，增强视觉推理、文档识别、细节信息理解和指令遵循能力。',
    displayName: 'Doubao 1.5 Vision Pro 32k',
    id: 'doubao-1.5-vision-pro-32k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-01-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-pro-250328',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-vision-pro 全新升级的多模态大模型，支持任意分辨率和极端长宽比图像识别，增强视觉推理、文档识别、细节信息理解和指令遵循能力。',
    displayName: 'Doubao 1.5 Vision Pro',
    id: 'doubao-1.5-vision-pro',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    config: {
      deploymentName: 'doubao-1-5-vision-lite-250315',
    },
    contextWindowTokens: 128_000,
    description:
      'Doubao-1.5-vision-lite 全新升级的多模态大模型，支持任意分辨率和极端长宽比图像识别，增强视觉推理、文档识别、细节信息理解和指令遵循能力。支持 128k 上下文窗口，输出长度支持最大 16k tokens。',
    displayName: 'Doubao 1.5 Vision Lite',
    id: 'doubao-1.5-vision-lite',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-03-15',
    type: 'chat',
  },
  {
    config: {
      deploymentName: 'doubao-lite-32k-240828',
    },
    contextWindowTokens: 32_768,
    description:
      '拥有极致的响应速度，更好的性价比，为客户不同场景提供更灵活的选择。支持 32k 上下文窗口的推理和精调。',
    displayName: 'Doubao Lite 32k',
    id: 'doubao-lite-32k',
    maxOutput: 4096,
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
    config: {
      deploymentName: 'doubao-pro-32k-241215',
    },
    contextWindowTokens: 32_768,
    description:
      '效果最好的主力模型，适合处理复杂任务，在参考问答、总结摘要、创作、文本分类、角色扮演等场景都有很好的效果。支持 32k 上下文窗口的推理和精调。',
    displayName: 'Doubao Pro 32k',
    id: 'doubao-pro-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const volcengineImageModels: AIImageModelCard[] = [
  {
    /*
    // TODO: AIImageModelCard does not support config.deploymentName
    config: {
      deploymentName: 'doubao-seedream-3-0-t2i-250415',
    },
    */
    description:
      'Seedream 4.0 图片生成模型由字节跳动 Seed 团队研发，支持文字与图片输入，提供高可控、高质量的图片生成体验。基于文本提示词生成图片。',
    displayName: 'Seedream 4.0',
    enabled: true,
    id: 'doubao-seedream-4-0-250828',
    parameters: {
      imageUrls: { default: [], maxCount: 10, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: [
          '2048x2048',
          '2304x1728',
          '1728x2304',
          '2560x1440',
          '1440x2560',
          '2496x1664',
          '1664x2496',
          '3024x1296',
        ],
      },
    },
    releasedAt: '2025-09-09',
    type: 'image',
  },
  {
    /*
    // TODO: AIImageModelCard does not support config.deploymentName
    config: {
      deploymentName: 'doubao-seedream-3-0-t2i-250415',
    },
    */
    description:
      'Seedream 3.0 图片生成模型由字节跳动 Seed 团队研发，支持文字与图片输入，提供高可控、高质量的图片生成体验。基于文本提示词生成图片。',
    displayName: 'Seedream 3.0 文生图',
    enabled: true,
    id: 'doubao-seedream-3-0-t2i-250415',
    parameters: {
      cfg: { default: 2.5, max: 10, min: 1, step: 0.1 },
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: [
          '1024x1024',
          '864x1152',
          '1152x864',
          '1280x720',
          '720x1280',
          '832x1248',
          '1248x832',
          '1512x648',
        ],
      },
    },
    releasedAt: '2025-04-15',
    type: 'image',
  },
  // Note: Doubao image-to-image and text-to-image models share the same Endpoint, currently switches to edit endpoint if imageUrl exists
  {
    // config: {
    //   deploymentName: 'doubao-seededit-3-0-i2i-250628',
    // },
    description:
      'Doubao图片生成模型由字节跳动 Seed 团队研发，支持文字与图片输入，提供高可控、高质量的图片生成体验。支持通过文本指令编辑图像，生成图像的边长在512～1536之间。',
    displayName: 'SeedEdit 3.0 图生图',
    enabled: true,
    id: 'doubao-seededit-3-0-i2i-250628',
    parameters: {
      cfg: { default: 5.5, max: 10, min: 1, step: 0.1 },
      imageUrl: { default: null, maxFileSize: 10 * 1024 * 1024 },
      prompt: {
        default: '',
      },
      seed: { default: null },
    },
    releasedAt: '2025-06-28',
    type: 'image',
  },
];

export const allModels = [...doubaoChatModels, ...volcengineImageModels];

export default allModels;
