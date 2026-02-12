import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://cloud.baidu.com/doc/qianfan/s/rmh4stp0j

const wenxinChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Wenxin 5.0 Thinking is a native full-modal flagship model with unified text, image, audio, and video modeling. It delivers broad capability upgrades for complex QA, creation, and agent scenarios.',
    displayName: 'ERNIE 5.0 Thinking',
    enabled: true,
    id: 'ernie-5.0-thinking-latest',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 10,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 24,
              '[0.032, 0.128]': 40,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-12',
    settings: {
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
    contextWindowTokens: 131_072,
    description:
      'Wenxin 5.0 Thinking Preview is a native full-modal flagship model with unified text, image, audio, and video modeling. It delivers broad capability upgrades for complex QA, creation, and agent scenarios.',
    displayName: 'ERNIE 5.0 Thinking Preview',
    id: 'ernie-5.0-thinking-preview',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 10,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 24,
              '[0.032, 0.128]': 40,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-11-12',
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 Turbo 128K is a high-performance general model with search augmentation and tool calling for QA, coding, and agent scenarios.',
    displayName: 'ERNIE 4.5 Turbo 128K',
    enabled: true,
    id: 'ernie-4.5-turbo-128k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 Turbo 128K preview with release-level capabilities, suitable for integration and canary testing.',
    displayName: 'ERNIE 4.5 Turbo 128K Preview',
    id: 'ernie-4.5-turbo-128k-preview',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 32_768,
    description:
      'ERNIE 4.5 Turbo 32K is a mid-length context version for QA, knowledge base retrieval, and multi-turn dialogue.',
    displayName: 'ERNIE 4.5 Turbo 32K',
    id: 'ernie-4.5-turbo-32k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Latest ERNIE 4.5 Turbo with optimized overall performance, ideal as the primary production model.',
    displayName: 'ERNIE 4.5 Turbo Latest',
    id: 'ernie-4.5-turbo-latest',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'ERNIE Speed Pro 128K is a high-concurrency, high-value model for large-scale online services and enterprise apps.',
    displayName: 'ERNIE Speed Pro 128K',
    id: 'ernie-speed-pro-128k',
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
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE Lite Pro 128K is a lightweight high-performance model for latency- and cost-sensitive scenarios.',
    displayName: 'ERNIE Lite Pro 128K',
    id: 'ernie-lite-pro-128k',
    maxOutput: 4096,
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
    contextWindowTokens: 8192,
    description:
      'ERNIE Character 8K is a persona dialogue model for IP character building and long-term companionship chat.',
    displayName: 'ERNIE Character 8K',
    id: 'ernie-char-8k',
    maxOutput: 2048,
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
    contextWindowTokens: 8192,
    description:
      'ERNIE Character Fiction 8K is a persona model for novels and plot creation, suited for long-form story generation.',
    displayName: 'ERNIE Character Fiction 8K',
    id: 'ernie-char-fiction-8k',
    maxOutput: 2048,
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
    contextWindowTokens: 8192,
    description:
      'ERNIE Character Fiction 8K Preview is a character and plot creation model preview for feature evaluation and testing.',
    displayName: 'ERNIE Character Fiction 8K Preview',
    id: 'ernie-char-fiction-8k-preview',
    maxOutput: 2048,
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
    contextWindowTokens: 8192,
    description:
      'ERNIE Novel 8K is built for long-form novels and IP plots with multi-character narratives.',
    displayName: 'ERNIE Novel 8K',
    id: 'ernie-novel-8k',
    maxOutput: 2048,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 120, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 0.3B is an open-source lightweight model for local and customized deployment.',
    displayName: 'ERNIE 4.5 0.3B',
    id: 'ernie-4.5-0.3b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 21B A3B is an open-source large-parameter model with stronger understanding and generation.',
    displayName: 'ERNIE 4.5 21B A3B',
    id: 'ernie-4.5-21b-a3b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'ERNIE 4.5 VL 28B A3B is an open-source multimodal model for image-text understanding and reasoning.',
    displayName: 'ERNIE 4.5 VL 28B A3B',
    id: 'ernie-4.5-vl-28b-a3b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Qianfan Lightning 128B A19B is a high-performance Chinese general model for complex QA and large-scale reasoning.',
    displayName: 'Qianfan Lightning 128B A19B',
    id: 'qianfan-lightning-128b-a19b',
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
    contextWindowTokens: 32_768,
    description:
      'Qianfan 8B is a mid-size general model balancing cost and quality for text generation and QA.',
    displayName: 'Qianfan 8B',
    id: 'qianfan-8b',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qianfan 70B is a large Chinese model for high-quality generation and complex reasoning.',
    displayName: 'Qianfan 70B',
    id: 'qianfan-70b',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qianfan Agent Intent 32K targets intent recognition and agent orchestration with long context support.',
    displayName: 'Qianfan Agent Intent 32K',
    id: 'qianfan-agent-intent-32k',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Qianfan Agent Lite 8K is a lightweight agent model for low-cost multi-turn dialogue and workflows.',
    displayName: 'Qianfan Agent Lite 8K',
    id: 'qianfan-agent-lite-8k',
    maxOutput: 2048,
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 Turbo VL Preview is a multimodal preview model for image-text understanding and generation, suitable for visual QA and content comprehension.',
    displayName: 'ERNIE 4.5 Turbo VL Preview',
    id: 'ernie-4.5-turbo-vl-preview',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 Turbo VL is a mature multimodal model for production image-text understanding and recognition.',
    displayName: 'ERNIE 4.5 Turbo VL',
    id: 'ernie-4.5-turbo-vl',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
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
      'ERNIE 4.5 Turbo VL 32K is a mid-long multimodal version for combined long-doc and image understanding.',
    displayName: 'ERNIE 4.5 Turbo VL 32K',
    id: 'ernie-4.5-turbo-vl-32k',
    maxOutput: 12_288,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
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
      'ERNIE 4.5 Turbo VL 32K Preview is a 32K multimodal preview for evaluating long-context vision ability.',
    displayName: 'ERNIE 4.5 Turbo VL 32K Preview',
    id: 'ernie-4.5-turbo-vl-32k-preview',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'ERNIE 4.5 Turbo VL Latest is the newest multimodal version with improved image-text understanding and reasoning.',
    displayName: 'ERNIE 4.5 Turbo VL Latest',
    id: 'ernie-4.5-turbo-vl-latest',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 8192,
    description: 'ERNIE 4.5 8K Preview is an 8K context preview model for evaluating ERNIE 4.5.',
    displayName: 'ERNIE 4.5 8K Preview',
    id: 'ernie-4.5-8k-preview',
    maxOutput: 2048,
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
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qianfan Composition is a multimodal creation model for mixed image-text understanding and generation.',
    displayName: 'Qianfan Composition',
    id: 'qianfan-composition',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qianfan Check VL is a multimodal content review model for image-text compliance and recognition tasks.',
    displayName: 'Qianfan Check VL',
    id: 'qianfan-check-vl',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qianfan MultiPicOCR is a multi-image OCR model for text detection and recognition across images.',
    displayName: 'Qianfan MultiPicOCR',
    id: 'qianfan-multipicocr',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'Qianfan VL 70B is a large VLM for complex image-text understanding.',
    displayName: 'Qianfan VL 70B',
    id: 'qianfan-vl-70b',
    maxOutput: 28_672,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'Qianfan VL 8B is a lightweight VLM for daily image-text QA and analysis.',
    displayName: 'Qianfan VL 8B',
    id: 'qianfan-vl-8b',
    maxOutput: 28_672,
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
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Qianfan Llama VL 8B is a Llama-based multimodal model for general image-text understanding.',
    displayName: 'Qianfan Llama VL 8B',
    id: 'qianfan-llama-vl-8b',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qianfan QI VL is a multimodal QA model for accurate retrieval and QA in complex image-text scenarios.',
    displayName: 'Qianfan QI VL',
    id: 'qianfan-qi-vl',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qianfan EngCard VL is a multimodal recognition model focused on English scenarios.',
    displayName: 'Qianfan EngCard VL',
    id: 'qianfan-engcard-vl',
    maxOutput: 4000,
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
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'Qianfan SinglePicOCR is a single-image OCR model with high-accuracy character recognition.',
    displayName: 'Qianfan SinglePicOCR',
    id: 'qianfan-singlepicocr',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      'InternVL3 38B is a large open-source multimodal model for high-accuracy image-text understanding.',
    displayName: 'InternVL3 38B',
    id: 'internvl3-38b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description: 'InternVL3 14B is a mid-size multimodal model balancing performance and cost.',
    displayName: 'InternVL3 14B',
    id: 'internvl3-14b',
    maxOutput: 8192,
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
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_768,
    description:
      'InternVL3 1B is a lightweight multimodal model for resource-constrained deployment.',
    displayName: 'InternVL3 1B',
    id: 'internvl3-1b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
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
      'InternVL2.5 38B MPO is a multimodal pretrained model for complex image-text reasoning.',
    displayName: 'InternVL2.5 38B MPO',
    id: 'internvl2.5-38b-mpo',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3 VL 32B Instruct is a multimodal instruction-tuned model for high-quality image-text QA and creation.',
    displayName: 'Qwen3 VL 32B Instruct',
    id: 'qwen3-vl-32b-instruct',
    maxOutput: 32_768,
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 32B Thinking is a deep-thinking multimodal version for complex reasoning and long-chain analysis.',
    displayName: 'Qwen3 VL 32B Thinking',
    id: 'qwen3-vl-32b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3 VL 8B Instruct is a lightweight multimodal model for daily visual QA and app integration.',
    displayName: 'Qwen3 VL 8B Instruct',
    id: 'qwen3-vl-8b-instruct',
    maxOutput: 32_768,
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 8B Thinking is a multimodal chain-of-thought model for detailed visual reasoning.',
    displayName: 'Qwen3 VL 8B Thinking',
    id: 'qwen3-vl-8b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3 VL 30B A3B Instruct is a large multimodal model balancing accuracy and reasoning performance.',
    displayName: 'Qwen3 VL 30B A3B Instruct',
    id: 'qwen3-vl-30b-a3b-instruct',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3 VL 30B A3B Thinking is a deep-thinking version for complex multimodal tasks.',
    displayName: 'Qwen3 VL 30B A3B Thinking',
    id: 'qwen3-vl-30b-a3b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen3 VL 235B A22B Instruct is a flagship multimodal model for demanding understanding and creation.',
    displayName: 'Qwen3 VL 235B A22B Instruct',
    id: 'qwen3-vl-235b-a22b-instruct',
    maxOutput: 32_768,
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 VL 235B A22B Thinking is the flagship thinking version for complex multimodal reasoning and planning.',
    displayName: 'Qwen3 VL 235B A22B Thinking',
    id: 'qwen3-vl-235b-a22b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
      'Qwen2.5 VL 32B Instruct is an open-source multimodal model suitable for private deployment and multi-scenario use.',
    displayName: 'Qwen2.5 VL 32B Instruct',
    id: 'qwen2.5-vl-32b-instruct',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 16_384,
    description:
      'Qwen2.5 VL 7B Instruct is a lightweight multimodal model balancing deployment cost and recognition ability.',
    displayName: 'Qwen2.5 VL 7B Instruct',
    id: 'qwen2.5-vl-7b-instruct',
    maxOutput: 4096,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 65_536,
    description:
      'GLM-4.5V is a multimodal vision-language model for general image understanding and QA.',
    displayName: 'GLM-4.5V',
    id: 'glm-4.5v',
    maxOutput: 16_384,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 2,
              '[0.032, 0.064]': 4,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, 0.064]': 12,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      'DeepSeek VL2 is a multimodal model for image-text understanding and fine-grained visual QA.',
    displayName: 'DeepSeek VL2',
    id: 'deepseek-vl2',
    maxOutput: 2048,
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
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'DeepSeek VL2 Small is a lightweight multimodal version for resource-constrained and high-concurrency use.',
    displayName: 'DeepSeek VL2 Small',
    id: 'deepseek-vl2-small',
    maxOutput: 2048,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 65_536,
    description: 'ERNIE X1.1 Preview is a thinking-model preview for evaluation and testing.',
    displayName: 'ERNIE X1.1 Preview',
    enabled: true,
    id: 'ernie-x1.1-preview',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 32_768,
    description:
      'ERNIE X1 Turbo 32K is a fast thinking model with 32K context for complex reasoning and multi-turn chat.',
    displayName: 'ERNIE X1 Turbo 32K',
    id: 'ernie-x1-turbo-32k',
    maxOutput: 28_160,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 144_000,
    description:
      'DeepSeek V3.2 Think is a full deep-thinking model with stronger long-chain reasoning.',
    displayName: 'DeepSeek V3.2 Think',
    enabled: true,
    id: 'deepseek-v3.2-think',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 144_000,
    description:
      'DeepSeek V3.1 Think 250821 is the deep-thinking model corresponding to the Terminus version, built for high-performance reasoning.',
    displayName: 'DeepSeek V3.1 Think 250821',
    id: 'deepseek-v3.1-think-250821',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 144_000,
    description:
      'DeepSeek R1 250528 is the full DeepSeek-R1 reasoning model for hard math and logic tasks.',
    displayName: 'DeepSeek R1 250528',
    id: 'deepseek-r1-250528',
    maxOutput: 32_768,
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
      reasoning: true,
      search: true,
    },
    contextWindowTokens: 144_000,
    description:
      'DeepSeek R1 (current 250120) is a deep reasoning model with open chain-of-thought output.',
    displayName: 'DeepSeek R1 250120',
    id: 'deepseek-r1',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qianfan 70B is an R1 distill based on Qianfan-70B with strong value.',
    displayName: 'DeepSeek R1 Distill Qianfan 70B',
    id: 'deepseek-r1-distill-qianfan-70b',
    maxOutput: 8192,
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
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qianfan 8B is an R1 distill based on Qianfan-8B for small and mid-sized apps.',
    displayName: 'DeepSeek R1 Distill Qianfan 8B',
    id: 'deepseek-r1-distill-qianfan-8b',
    maxOutput: 8192,
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
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description: 'DeepSeek R1 Distill Qianfan Llama 70B is an R1 distill based on Llama-70B.',
    displayName: 'DeepSeek R1 Distill Qianfan Llama 70B',
    id: 'deepseek-r1-distill-qianfan-llama-70b',
    maxOutput: 8192,
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
    contextWindowTokens: 32_768,
    description: 'DeepSeek R1 Distill Llama 70B combines R1 reasoning with the Llama ecosystem.',
    displayName: 'DeepSeek R1 Distill Llama 70B',
    id: 'deepseek-r1-distill-llama-70b',
    maxOutput: 8192,
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
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qwen 32B is an R1 distill based on Qwen-32B, balancing performance and cost.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    id: 'deepseek-r1-distill-qwen-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qwen 14B is a mid-size distill model for multi-scenario deployment.',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    id: 'deepseek-r1-distill-qwen-14b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qwen 7B is a lightweight distill model for edge and private enterprise environments.',
    displayName: 'DeepSeek R1 Distill Qwen 7B',
    id: 'deepseek-r1-distill-qwen-7b',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek R1 Distill Qwen 1.5B is an ultra-light distill model for very low-resource environments.',
    displayName: 'DeepSeek R1 Distill Qwen 1.5B',
    id: 'deepseek-r1-distill-qwen-1.5b',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 Next 80B A3B Thinking is a flagship reasoning model version for complex tasks.',
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'qwen3-next-80b-a3b-thinking',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3 235B A22B Thinking 2507 is an ultra-large thinking model for hard reasoning.',
    displayName: 'Qwen3 235B A22B Thinking 2507',
    id: 'qwen3-235b-a22b-thinking-2507',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 20, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3 30B A3B Thinking 2507 is a mid-large thinking model balancing accuracy and cost.',
    displayName: 'Qwen3 30B A3B Thinking 2507',
    id: 'qwen3-30b-a3b-thinking-2507',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
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
    contextWindowTokens: 32_768,
    description:
      'QWQ-32B is a large open-source reasoning model, suitable as a reasoning core for agents.',
    displayName: 'QWQ 32B',
    id: 'qwq-32b',
    maxOutput: 8192,
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
    description:
      'Kimi K2 Instruct is Kimi’s official reasoning model with long context for code, QA, and more.',
    displayName: 'Kimi K2 Instruct',
    id: 'kimi-k2-instruct',
    maxOutput: 32_768,
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
    contextWindowTokens: 131_072,
    description:
      'Qwen3 Coder 480B A35B Instruct is a flagship code model for multilingual programming and complex code understanding.',
    displayName: 'Qwen3 Coder 480B A35B Instruct',
    id: 'qwen3-coder-480b-a35b-instruct',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]': 6,
              '[0.032, 0.128]': 9,
            },
            pricingParams: ['textInput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]': 24,
              '[0.032, 0.128]': 36,
            },
            pricingParams: ['textInput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
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
      'Qwen3 235B A22B Instruct 2507 is a flagship instruct model for a wide range of generation and reasoning tasks.',
    displayName: 'Qwen3 235B A22B Instruct 2507',
    id: 'qwen3-235b-a22b-instruct-2507',
    maxOutput: 32_768,
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
      search: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Qwen3 30B A3B Instruct 2507 is a mid-large instruct model for high-quality generation and QA.',
    displayName: 'Qwen3 30B A3B Instruct 2507',
    id: 'qwen3-30b-a3b-instruct-2507',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen3 30B A3B is a mid-large general model balancing cost and quality.',
    displayName: 'Qwen3 30B A3B',
    id: 'qwen3-30b-a3b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen3 32B is suited for general tasks requiring stronger understanding.',
    displayName: 'Qwen3 32B',
    id: 'qwen3-32b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen3 14B is a mid-size model for multilingual QA and text generation.',
    displayName: 'Qwen3 14B',
    id: 'qwen3-14b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen3 8B is a lightweight model with flexible deployment for high-concurrency workloads.',
    displayName: 'Qwen3 8B',
    id: 'qwen3-8b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen3 4B is suitable for small-to-mid apps and local inference.',
    displayName: 'Qwen3 4B',
    id: 'qwen3-4b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen3 1.7B is an ultra-light model for edge and device deployment.',
    displayName: 'Qwen3 1.7B',
    id: 'qwen3-1.7b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen3 0.6B is an entry-level model for simple reasoning and very constrained environments.',
    displayName: 'Qwen3 0.6B',
    id: 'qwen3-0.6b',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 7B Instruct is a mature open-source instruct model for multi-scenario chat and generation.',
    displayName: 'Qwen2.5 7B Instruct',
    id: 'qwen2.5-7b-instruct',
    maxOutput: 8192,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

const wenxinImageModels: AIImageModelCard[] = [
  {
    description:
      'ERNIE iRAG is an image retrieval-augmented generation model for image search, image-text retrieval, and content generation.',
    displayName: 'ERNIE iRAG',
    enabled: true,
    id: 'irag-1.0',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: [
          '768x768',
          '1024x1024',
          '1536x1536',
          '2048x2048',
          '1024x768',
          '2048x1536',
          '768x1024',
          '1536x2048',
          '1024x576',
          '2048x1152',
          '576x1024',
          '1152x2048',
        ],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-02-05',
    type: 'image',
  },
  {
    description:
      'ERNIE iRAG Edit is an image editing model supporting erasing, repainting, and variant generation.',
    displayName: 'ERNIE iRAG Edit',
    enabled: true,
    id: 'ernie-irag-edit',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: [
          '768x768',
          '1024x1024',
          '1536x1536',
          '2048x2048',
          '1024x768',
          '2048x1536',
          '768x1024',
          '1536x2048',
          '1024x576',
          '2048x1152',
          '576x1024',
          '1152x2048',
        ],
      },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.14, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-04-17',
    type: 'image',
  },
  {
    description:
      'FLUX.1-schnell is a high-performance image generation model for fast multi-style outputs.',
    displayName: 'FLUX.1-schnell',
    enabled: true,
    id: 'flux.1-schnell',
    parameters: {
      prompt: {
        default: '',
      },
      seed: { default: null },
      size: {
        default: '1024x1024',
        enum: [
          '768x768',
          '1024x1024',
          '1536x1536',
          '2048x2048',
          '1024x768',
          '2048x1536',
          '768x1024',
          '1536x2048',
          '1024x576',
          '2048x1152',
          '576x1024',
          '1152x2048',
        ],
      },
      steps: { default: 25, max: 50, min: 1 },
    },
    pricing: {
      currency: 'CNY',
      units: [{ name: 'imageGeneration', rate: 0.002, strategy: 'fixed', unit: 'image' }],
    },
    releasedAt: '2025-03-27',
    type: 'image',
  },
];

export const allModels = [...wenxinChatModels, ...wenxinImageModels];

export default allModels;
