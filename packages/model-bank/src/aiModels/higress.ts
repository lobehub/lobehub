import type { AIChatModelCard } from '../types/aiModel';

const higressChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description: 'Ultra-large Qwen model supporting Chinese, English, and other languages.',
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
    description:
      'Enhanced ultra-large Qwen model supporting Chinese, English, and other languages.',
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
      'Hundred-billion-scale ultra-large Qwen model supporting Chinese, English, and other languages; the API model behind current Qwen2.5 products.',
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
      'Ultra-large Qwen model with long context and chat across long- and multi-document scenarios.',
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
      'Enhanced large-scale Qwen vision-language model with major gains in detail and text recognition, supporting over one-megapixel resolution and arbitrary aspect ratios.',
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
      'Ultra-large Qwen vision-language model. Compared to the enhanced version, it further improves visual reasoning and instruction following for stronger perception and cognition.',
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
    description: 'Qwen Math is a language model specialized for solving math problems.',
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
    description: 'Qwen Math is a language model specialized for solving math problems.',
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
    description: 'Qwen code model.',
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
    description: 'Qwen2.5 open-source 7B model.',
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
    description: 'Qwen2.5 open-source 14B model.',
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
    description: 'Qwen2.5 open-source 32B model.',
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
    description: 'Qwen2.5 open-source 72B model.',
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
    description: 'Qwen-Math delivers strong math problem-solving.',
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
    description: 'Qwen-Math delivers strong math problem-solving.',
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
    description: 'Qwen-Math delivers strong math problem-solving.',
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
    description: 'Open-source Qwen code model.',
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
    description: 'Open-source Qwen code model.',
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
    description:
      'Pretrained model initialized from Qwen-7B with an added vision module and 448 image resolution input.',
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
    description:
      'Qwen VL supports flexible interactions including multi-image input, multi-turn QA, and creative tasks.',
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
      'Moonshot V1 8K is designed for short-text generation with efficient processing, handling 8,192 tokens for brief chats, quick notes, and fast content generation.',
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
      'Moonshot V1 32K provides mid-length context handling up to 32,768 tokens, ideal for long documents and complex dialogues in content creation, report writing, and chat systems.',
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
      'Moonshot V1 128K offers ultra-long context up to 128,000 tokens, suited for very long text generation and complex tasks in research, academia, and large document creation.',
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
      'Top domestic performance, surpassing leading overseas models on Chinese tasks like encyclopedic knowledge, long text, and creative generation. Also offers industry-leading multimodal capabilities and strong benchmark results.',
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
      'Optimized for high-frequency enterprise scenarios with major gains and strong value. Compared to Baichuan2, content creation improves by 20%, knowledge QA by 17%, and roleplay by 40%. Overall performance is better than GPT-3.5.',
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
      'With a 128K ultra-long context window, it is optimized for high-frequency enterprise scenarios with major gains and strong value. Compared to Baichuan2, content creation improves by 20%, knowledge QA by 17%, and roleplay by 40%. Overall performance is better than GPT-3.5.',
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
      'Uses search augmentation to connect the model with domain and web knowledge. Supports PDF/Word uploads and URL inputs for timely, comprehensive retrieval and professional, accurate outputs.',
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
    description:
      'Latest high-performance model with high-quality output and much faster reasoning.',
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
    description:
      'Small but powerful, lightweight and ultra-fast, with enhanced math and coding capabilities.',
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
    description:
      'Upgraded mid-size model with balanced capabilities, strong value, and improved instruction following.',
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
    description: '200K ultra-long context window for deep long-text understanding and generation.',
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
    description:
      'Excellent value and performance, tuned to balance capability, reasoning speed, and cost.',
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
      'Advanced service based on the powerful yi-large model, combining retrieval and generation for precise answers with real-time web search.',
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
      'Builds on yi-large with enhanced tool calling, suitable for agent or workflow business scenarios.',
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
    description: 'New 100B-parameter model with strong QA and text generation.',
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
    description:
      'Model for complex visual tasks with high-performance image understanding and analysis.',
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
    description: 'Early version; recommended to use yi-large (new version).',
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
    description: 'Lightweight version; recommended to use yi-lightning.',
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
    description: 'GLM-4-Flash is ideal for simple tasks: fastest and free.',
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
    description: 'GLM-4-FlashX is an enhanced Flash version with ultra-fast reasoning.',
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
    description:
      'GLM-4-Long supports ultra-long inputs for memory-style tasks and large-scale document processing.',
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
    description:
      'GLM-4-Air is a high-value option with performance close to GLM-4, fast speed, and lower cost.',
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
    description:
      'GLM-4-AirX is a more efficient GLM-4-Air variant with up to 2.6x faster reasoning.',
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
      'GLM-4-AllTools is a versatile agent model optimized for complex instruction planning and tool use such as web browsing, code explanation, and text generation, suitable for multi-task execution.',
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
    description:
      'GLM-4-Plus is a high-intelligence flagship with strong long-text and complex-task handling and upgraded overall performance.',
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
    description:
      'GLM-4-0520 is the latest model version, designed for highly complex and diverse tasks with excellent performance.',
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
    description:
      'GLM-4 is the older flagship released in Jan 2024, now replaced by the stronger GLM-4-0520.',
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
    description:
      'GLM-4V-Plus understands video and multiple images, suitable for multimodal tasks.',
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
    description: 'GLM-4V provides strong image understanding and reasoning across visual tasks.',
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
    description:
      'CharGLM-3 is built for roleplay and emotional companionship, supporting ultra-long multi-turn memory and personalized dialogue.',
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
    description:
      'Emohaa is a mental health model with professional counseling abilities to help users understand emotional issues.',
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
      '360GPT2 Pro is an advanced NLP model from 360 with excellent text generation and understanding, especially for creative tasks, handling complex transformations and roleplay.',
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
      '360GPT Pro is a key 360 AI model with efficient text processing for diverse NLP scenarios, supporting long-text understanding and multi-turn dialogue.',
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
      '360GPT Turbo delivers strong compute and chat capability with excellent semantic understanding and generation efficiency, ideal for enterprise and developers.',
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
      '360GPT Turbo Responsibility 8K emphasizes semantic safety and responsibility for content-sensitive applications, ensuring accurate and robust user experiences.',
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
      'Baidu’s flagship large-scale LLM trained on massive Chinese/English corpora with strong general ability for chat, creation, and plugin use; supports automatic Baidu Search plugin integration for fresh answers.',
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
      'Baidu’s flagship large-scale LLM trained on massive Chinese/English corpora with strong general ability for chat, creation, and plugin use; supports automatic Baidu Search plugin integration for fresh answers.',
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
      'Baidu’s flagship large-scale LLM trained on massive Chinese/English corpora with strong general ability for chat, creation, and plugin use; supports automatic Baidu Search plugin integration for fresh answers.',
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
      'Baidu’s flagship ultra-large LLM with comprehensive upgrades over ERNIE 3.5, suitable for complex tasks across domains; supports Baidu Search plugin integration for fresh answers.',
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
      'Baidu’s flagship ultra-large LLM with comprehensive upgrades over ERNIE 3.5, suitable for complex tasks across domains; supports Baidu Search plugin integration for fresh answers.',
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
      'Baidu’s flagship ultra-large LLM with strong overall performance for complex tasks, with Baidu Search plugin integration for fresh answers. It outperforms ERNIE 4.0.',
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
      'Baidu’s flagship ultra-large LLM with strong overall performance for complex tasks, with Baidu Search plugin integration for fresh answers. It outperforms ERNIE 4.0.',
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
      'Baidu’s lightweight LLM balancing quality and inference performance, better than ERNIE Lite and suitable for low-compute accelerators.',
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
      'Baidu’s latest high-performance LLM (2024) with strong general ability, better than ERNIE Speed, suitable as a base for fine-tuning with excellent reasoning performance.',
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
      'Baidu’s latest high-performance LLM (2024) with strong general ability, suitable as a base for fine-tuning to handle specific scenarios, with excellent reasoning performance.',
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
      'Baidu’s vertical-domain LLM for game NPCs, customer service, and roleplay, with clearer persona consistency, stronger instruction following, and better reasoning.',
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
      'Upgraded to an MoE architecture with a 256K context window, leading many open-source models across NLP, code, math, and domain benchmarks.',
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
      'Uses improved routing to mitigate load balancing and expert collapse. Long-text "needle in a haystack" reaches 99.9%. MOE-32K offers better value while balancing quality and price for long-text inputs.',
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
      'Uses improved routing to mitigate load balancing and expert collapse. Long-text "needle in a haystack" reaches 99.9%. MOE-256K pushes further in length and quality, greatly expanding input length.',
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
      'Preview of Hunyuan’s next-gen LLM with a new MoE architecture, delivering faster reasoning and stronger results than hunyuan-pro.',
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
      'Trillion-parameter MOE-32K long-context model leading benchmarks, strong at complex instructions and reasoning, advanced math, function calling, and optimized for multilingual translation, finance, law, and medical domains.',
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
    description: 'Hunyuan latest multimodal model supporting image + text inputs to generate text.',
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
      'Hunyuan’s latest code model trained on 200B high-quality code data plus six months of SFT data, with 8K context. It ranks near the top in automated code benchmarks and in expert human evaluations across five languages.',
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
      'Hunyuan’s latest MoE FunctionCall model trained on high-quality tool-call data, with a 32K context window and leading benchmarks across dimensions.',
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
      'Hunyuan’s latest roleplay model, officially fine-tuned with roleplay data, delivering stronger base performance in roleplay scenarios.',
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
    description: 'High-speed model suitable for real-time chat.',
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
    description: 'Small model suited for lightweight tasks.',
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
    description: 'Supports mid-length conversations for a wide range of scenarios.',
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
    description: 'Balances performance and cost for general scenarios.',
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
    description: 'Extra-long context handling, ideal for long-document analysis.',
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
    description: 'Supports large-context interactions for complex dialogues.',
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
    description: 'Small vision model for basic image-and-text tasks.',
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
    description: 'Supports vision inputs for richer multimodal interaction.',
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
    description: 'Strong video understanding capabilities.',
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
      'Spark Lite is a lightweight LLM with ultra-low latency and efficient processing, fully free and supporting real-time web search. Its fast responses shine on low-compute devices and fine-tuning, offering strong value for knowledge QA, content creation, and search.',
    displayName: 'Spark Lite',
    enabled: true,
    id: 'lite',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Pro is a high-performance LLM optimized for professional domains like math, coding, healthcare, and education, with web search and built-in plugins such as weather and date. It excels at complex QA, language understanding, and advanced writing for professional use.',
    displayName: 'Spark Pro',
    enabled: true,
    id: 'generalv3',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Spark Pro 128K supports up to 128K context, ideal for full-document analysis and long-range reasoning, providing coherent logic and rich citations in complex text communication.',
    displayName: 'Spark Pro 128K',
    enabled: true,
    id: 'pro-128k',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Max is the most full-featured version, with web search and many built-in plugins. Its optimized core capabilities plus system roles and function calling excel across complex scenarios.',
    displayName: 'Spark Max',
    enabled: true,
    id: 'generalv3.5',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Spark Max 32K offers large-context processing with stronger understanding and logical reasoning, supporting 32K input for long documents and private knowledge QA.',
    displayName: 'Spark Max 32K',
    enabled: true,
    id: 'max-32k',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Spark Ultra is the most powerful Spark model, improving web search integration and text understanding/summarization. It is a comprehensive solution for productivity and accurate responses.',
    displayName: 'Spark 4.0 Ultra',
    enabled: true,
    id: '4.0Ultra',
    maxOutput: 8192,
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'o1-mini is a fast, cost-effective reasoning model designed for coding, math, and science. It has 128K context and an October 2023 knowledge cutoff.',
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
      'o1 is OpenAI’s new reasoning model for complex tasks requiring broad knowledge. It has 128K context and an October 2023 knowledge cutoff.',
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
      'GPT-4o mini is OpenAI’s latest model after GPT-4 Omni, supporting image+text input with text output. As their most advanced small model, it is much cheaper than recent frontier models and over 60% cheaper than GPT-3.5 Turbo, while retaining top-tier intelligence. It scores 82% on MMLU and ranks above GPT-4 in chat preference.',
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
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
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
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
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
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
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
      'ChatGPT-4o is a dynamic model updated in real time. It combines strong language understanding and generation for large-scale use cases like customer support, education, and technical assistance.',
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
      'The latest GPT-4 Turbo model includes vision. Vision requests can use JSON mode and function calling. GPT-4 Turbo is an enhanced version that balances accuracy and efficiency for cost-effective multimodal tasks and real-time interactions.',
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
      'The latest GPT-4 Turbo model includes vision. Vision requests can use JSON mode and function calling. GPT-4 Turbo is an enhanced version that balances accuracy and efficiency for cost-effective multimodal tasks and real-time interactions.',
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
      'The latest GPT-4 Turbo model includes vision. Vision requests can use JSON mode and function calling. GPT-4 Turbo is an enhanced version that balances accuracy and efficiency for cost-effective multimodal tasks and real-time interactions.',
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
      'The latest GPT-4 Turbo model includes vision. Vision requests can use JSON mode and function calling. GPT-4 Turbo is an enhanced version that balances accuracy and efficiency for cost-effective multimodal tasks and real-time interactions.',
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
      'The latest GPT-4 Turbo model includes vision. Vision requests can use JSON mode and function calling. GPT-4 Turbo is an enhanced version that balances accuracy and efficiency for cost-effective multimodal tasks and real-time interactions.',
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
      'GPT-4 provides a larger context window to handle longer inputs for scenarios needing broad information integration and data analysis.',
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
      'GPT-4 provides a larger context window to handle longer inputs for scenarios needing broad information integration and data analysis.',
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
      'GPT-4 provides a larger context window to handle longer inputs for scenarios needing broad information integration and data analysis.',
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
      'GPT-4 provides a larger context window to handle longer inputs for scenarios needing broad information integration and data analysis.',
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
      'GPT-3.5 Turbo for text generation and understanding. Currently points to gpt-3.5-turbo-0125.',
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
      'GPT-3.5 Turbo for text generation and understanding. Currently points to gpt-3.5-turbo-0125.',
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
      'GPT-3.5 Turbo for text generation and understanding. Currently points to gpt-3.5-turbo-0125.',
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
      'GPT-3.5 Turbo for text generation and understanding. Currently points to gpt-3.5-turbo-0125.',
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
      'GPT-3.5 Turbo is OpenAI’s efficient model for chat and text generation, supporting parallel function calling.',
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
    description: 'GPT-3.5 Turbo 16k is a high-capacity text generation model for complex tasks.',
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
    description:
      'GPT-4 Turbo is a multimodal model with excellent language understanding and generation plus image input.',
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
    description: 'GPT-4 Vision preview, designed for image analysis and processing tasks.',
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
    description: 'GPT-4o Mini is a small, efficient model with performance comparable to GPT-4o.',
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
    description: 'GPT-4o is the latest multimodal model with advanced text and image processing.',
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
    description:
      'Smaller and faster than o1-preview, 80% lower cost, strong at code generation and short-context tasks.',
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
      'Focused on advanced reasoning and complex problem solving, including math and science. Ideal for applications needing deep context understanding and autonomous workflows.',
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
    description: 'A cost-effective AI solution for a wide range of text and image tasks.',
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
    description:
      'The most advanced multimodal model in the GPT-4 family, handling text and image inputs.',
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
      'A 52B-parameter (12B active) multilingual model with a 256K context window, function calling, structured output, and grounded generation.',
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
      'A 398B-parameter (94B active) multilingual model with a 256K context window, function calling, structured output, and grounded generation.',
    displayName: 'AI21 Jamba 1.5 Large',
    id: 'ai21-jamba-1.5-large',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Command R is a scalable generative model designed for RAG and tool use, enabling production-grade AI.',
    displayName: 'Cohere Command R',
    id: 'cohere-command-r',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Command R+ is an advanced RAG-optimized model built for enterprise workloads.',
    displayName: 'Cohere Command R+',
    id: 'cohere-command-r-plus',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral Nemo is a cutting-edge LLM with state-of-the-art reasoning, world knowledge, and coding for its size.',
    displayName: 'Mistral Nemo',
    id: 'mistral-nemo',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral Small is suitable for any language-based task requiring high efficiency and low latency.',
    displayName: 'Mistral Small',
    id: 'mistral-small',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral’s flagship model for complex tasks needing large-scale reasoning or specialization (synthetic text, code, RAG, or agents).',
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
    description:
      'Strong image reasoning on high-resolution images, suited for visual understanding apps.',
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
    description: 'Advanced image reasoning for visual-understanding agent applications.',
    displayName: 'Llama 3.2 90B Vision',
    id: 'llama-3.2-90b-vision-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 8B',
    id: 'meta-llama-3.1-8b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 70B',
    id: 'meta-llama-3.1-70b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 405B',
    id: 'meta-llama-3.1-405b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'A versatile 8B-parameter model optimized for chat and text generation.',
    displayName: 'Meta Llama 3 8B',
    id: 'meta-llama-3-8b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A powerful 70B-parameter model that excels at reasoning, coding, and broad language tasks.',
    displayName: 'Meta Llama 3 70B',
    id: 'meta-llama-3-70b-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'An updated version of the Phi-3-mini model.',
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
    description: 'An updated version of the Phi-3-vision model.',
    displayName: 'Phi-3.5-vision 128K',
    id: 'Phi-3.5-vision-instrust',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'The smallest Phi-3 family member, optimized for quality and low latency.',
    displayName: 'Phi-3-mini 4K',
    id: 'Phi-3-mini-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-mini model with a larger context window for RAG or few-shot prompts.',
    displayName: 'Phi-3-mini 128K',
    id: 'Phi-3-mini-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A 7B-parameter model with higher quality than Phi-3-mini, focused on high-quality, reasoning-intensive data.',
    displayName: 'Phi-3-small 8K',
    id: 'Phi-3-small-8k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-small model with a larger context window for RAG or few-shot prompts.',
    displayName: 'Phi-3-small 128K',
    id: 'Phi-3-small-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'A 14B-parameter model with higher quality than Phi-3-mini, focused on high-quality, reasoning-intensive data.',
    displayName: 'Phi-3-medium 4K',
    id: 'Phi-3-medium-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-medium model with a larger context window for RAG or few-shot prompts.',
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
      'Llama 3.2 is designed for tasks combining vision and text, excelling at image captioning and visual QA to bridge language generation and visual reasoning.',
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
      'Llama 3.2 is designed for tasks combining vision and text, excelling at image captioning and visual QA to bridge language generation and visual reasoning.',
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
      'Llama 3.1 8B is a high-efficiency model with fast text generation, ideal for large-scale, cost-effective applications.',
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
      'Llama 3.1 70B delivers stronger AI reasoning for complex applications, supporting heavy compute with high efficiency and accuracy.',
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
    description:
      'Llama 3 Groq 8B Tool Use is optimized for efficient tool use with fast parallel compute.',
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
    description:
      'Llama 3 Groq 70B Tool Use provides strong tool-calling for efficient handling of complex tasks.',
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
    description: 'Meta Llama 3 8B delivers strong reasoning performance for diverse scenarios.',
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
    description: 'Meta Llama 3 70B offers exceptional complexity handling for demanding projects.',
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
    description: 'Gemma 2 9B is optimized for specific tasks and tool integration.',
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
    description: 'Gemma 7B is cost-effective for small to mid-scale tasks.',
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
    description: 'Mixtral 8x7B provides fault-tolerant parallel compute for complex tasks.',
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
    description:
      'LLaVA 1.5 7B fuses visual processing to generate complex outputs from visual inputs.',
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
      'A new open-source model combining general and code abilities. It preserves the chat model’s general dialogue and the coder model’s strong coding, with better preference alignment. DeepSeek-V2.5 also improves writing and instruction following.',
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
      'Claude 3.5 Haiku is Anthropic’s fastest next-gen model. Compared to Claude 3 Haiku, it improves across skills and surpasses the prior largest model Claude 3 Opus on many intelligence benchmarks.',
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
      'Claude 3 Haiku is Anthropic’s fastest and most compact model, designed for near-instant responses with fast, accurate performance.',
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
      'Claude 3 Sonnet balances intelligence and speed for enterprise workloads, delivering high utility at lower cost and reliable large-scale deployment.',
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
      'Claude 3 Opus is Anthropic’s most powerful model for highly complex tasks, excelling in performance, intelligence, fluency, and comprehension.',
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
      'Claude 2 delivers key enterprise improvements, including a leading 200K-token context, reduced hallucinations, system prompts, and a new test feature: tool calling.',
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
      'Claude 2 delivers key enterprise improvements, including a leading 200K-token context, reduced hallucinations, system prompts, and a new test feature: tool calling.',
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
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash is Google’s latest multimodal AI model with fast processing, supporting text, image, and video inputs for efficient scaling across tasks.',
    displayName: 'Gemini 1.5 Flash',
    enabled: true,
    id: 'gemini-1.5-flash-latest',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash 002 is an efficient multimodal model for broad application scaling.',
    displayName: 'Gemini 1.5 Flash 002',
    enabled: true,
    id: 'gemini-1.5-flash-002',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-25',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash 001 is an efficient multimodal model for broad application scaling.',
    displayName: 'Gemini 1.5 Flash 001',
    id: 'gemini-1.5-flash-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash 0827 delivers optimized multimodal processing for complex tasks.',
    displayName: 'Gemini 1.5 Flash 0827',
    id: 'gemini-1.5-flash-exp-0827',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-08-27',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash 8B is an efficient multimodal model for broad application scaling.',
    displayName: 'Gemini 1.5 Flash 8B',
    enabled: true,
    id: 'gemini-1.5-flash-8b',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-03',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_008_192,
    description:
      'Gemini 1.5 Flash 8B 0924 is the latest experimental model with notable gains across text and multimodal use cases.',
    displayName: 'Gemini 1.5 Flash 8B 0924',
    id: 'gemini-1.5-flash-8b-exp-0924',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.018, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-24',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro supports up to 2 million tokens, an ideal mid-sized multimodal model for complex tasks.',
    displayName: 'Gemini 1.5 Pro',
    enabled: true,
    id: 'gemini-1.5-pro-latest',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.875, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-02-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro 002 is the latest production-ready model with higher-quality outputs, especially improved in math, long context, and vision tasks.',
    displayName: 'Gemini 1.5 Pro 002',
    enabled: true,
    id: 'gemini-1.5-pro-002',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.315, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-24',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description: 'Gemini 1.5 Pro 001 is a scalable multimodal AI solution for complex tasks.',
    displayName: 'Gemini 1.5 Pro 001',
    id: 'gemini-1.5-pro-001',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.875, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-02-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro 0827 applies latest optimizations for more efficient multimodal processing.',
    displayName: 'Gemini 1.5 Pro 0827',
    id: 'gemini-1.5-pro-exp-0827',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.875, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-08-27',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 2_008_192,
    description:
      'Gemini 1.5 Pro 0801 provides strong multimodal processing with greater flexibility for app development.',
    displayName: 'Gemini 1.5 Pro 0801',
    id: 'gemini-1.5-pro-exp-0801',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.875, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-08-01',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Gemini 1.0 Pro is Google’s high-performance AI model designed for broad task scaling.',
    displayName: 'Gemini 1.0 Pro',
    id: 'gemini-1.0-pro-latest',
    maxOutput: 2048,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-12-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Gemini 1.0 Pro 001 (Tuning) provides stable, tunable performance for complex tasks.',
    displayName: 'Gemini 1.0 Pro 001 (Tuning)',
    id: 'gemini-1.0-pro-001',
    maxOutput: 2048,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-12-06',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Gemini 1.0 Pro 002 (Tuning) provides strong multimodal support for complex tasks.',
    displayName: 'Gemini 1.0 Pro 002 (Tuning)',
    id: 'gemini-1.0-pro-002',
    maxOutput: 2048,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2023-12-06',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Mistral Nemo is a 12B model co-developed with Nvidia, offering strong reasoning and coding performance with easy integration.',
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
    description:
      'Mistral Small is a cost-effective, fast, and reliable option for translation, summarization, and sentiment analysis.',
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
      'Mistral Large is the flagship model, excelling at multilingual tasks, complex reasoning, and code generation for high-end applications.',
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
    description:
      'Codestral is a cutting-edge code generation model optimized for fill-in-the-middle and code completion.',
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
      'Pixtral performs strongly on chart/diagram understanding, document QA, multimodal reasoning, and instruction following. It ingests images at native resolution/aspect and can handle any number of images in a 128K context window.',
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
    description: 'Ministral 3B is Mistral’s top-tier edge model.',
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
    description: 'Ministral 8B is Mistral’s high-value edge model.',
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
      'Mistral 7B is compact but high-performing, strong for batch processing and simple tasks like classification and text generation, with solid reasoning.',
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
      'Mixtral 8x7B is a sparse MoE model that boosts inference speed, suitable for multilingual and code generation tasks.',
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
      'Mixtral 8x22B is a larger MoE model for complex tasks, offering strong reasoning and higher throughput.',
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
      'Codestral Mamba is a Mamba-2 language model focused on code generation, supporting advanced code and reasoning tasks.',
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
    description:
      'Suitable for a wide range of NLP tasks, including text generation and dialogue systems.',
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
    description:
      'Designed for multilingual persona chat, supporting high-quality dialogue generation in English and other languages.',
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
    description:
      'Optimized for Chinese persona chat, providing fluent dialogue that fits Chinese expression habits.',
    displayName: 'abab6.5t',
    enabled: true,
    id: 'abab6.5t-chat',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Built for productivity scenarios with complex task handling and efficient text generation for professional use.',
    displayName: 'abab5.5',
    id: 'abab5.5-chat',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Designed for Chinese persona chat, delivering high-quality Chinese dialogue for various applications.',
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
      'Doubao-lite offers ultra-fast responses and better value, with flexible options across scenarios. Supports 4K context for inference and fine-tuning.',
    displayName: 'Doubao-lite-4k',
    id: 'Doubao-lite-4k',
    type: 'chat',
  },
  {
    description:
      'Doubao-lite offers ultra-fast responses and better value, with flexible options across scenarios. Supports 32K context for inference and fine-tuning.',
    displayName: 'Doubao-lite-32k',
    id: 'Doubao-lite-32k',
    type: 'chat',
  },
  {
    description:
      'Doubao-lite offers ultra-fast responses and better value, with flexible options across scenarios. Supports 128K context for inference and fine-tuning.',
    displayName: 'Doubao-lite-128k',
    id: 'Doubao-lite-128k',
    type: 'chat',
  },
  {
    description:
      'Best-performing flagship model for complex tasks, strong in reference QA, summarization, creation, classification, and roleplay. Supports 4K context for inference and fine-tuning.',
    displayName: 'Doubao-pro-4k',
    id: 'Doubao-pro-4k',
    type: 'chat',
  },
  {
    description:
      'Best-performing flagship model for complex tasks, strong in reference QA, summarization, creation, classification, and roleplay. Supports 32K context for inference and fine-tuning.',
    displayName: 'Doubao-pro-32k',
    id: 'Doubao-pro-32k',
    type: 'chat',
  },
  {
    description:
      'Best-performing flagship model for complex tasks, strong in reference QA, summarization, creation, classification, and roleplay. Supports 128K context for inference and fine-tuning.',
    displayName: 'Doubao-pro-128k',
    id: 'Doubao-pro-128k',
    type: 'chat',
  },
  {
    description:
      'Skylark 2nd-gen model. Skylark2-pro-character excels at roleplay and chat, matching prompts with distinct persona styles and natural dialogue for chatbots, virtual assistants, and customer service, with fast responses.',
    displayName: 'Skylark2-pro-character-4k',
    id: 'Skylark2-pro-character-4k',
    type: 'chat',
  },
  {
    description:
      'Skylark 2nd-gen model. Skylark2-pro offers higher accuracy for complex text generation such as professional copywriting, novel writing, and high-quality translation, with a 32K context window.',
    displayName: 'Skylark2-pro-32k',
    id: 'Skylark2-pro-32k',
    type: 'chat',
  },
  {
    description:
      'Skylark 2nd-gen model. Skylark2-pro offers higher accuracy for complex text generation such as professional copywriting, novel writing, and high-quality translation, with a 4K context window.',
    displayName: 'Skylark2-pro-4k',
    id: 'Skylark2-pro-4k',
    type: 'chat',
  },
  {
    description:
      'Skylark 2nd-gen model. Skylark2-pro-turbo-8k offers faster inference at lower cost with an 8K context window.',
    displayName: 'Skylark2-pro-turbo-8k',
    id: 'Skylark2-pro-turbo-8k',
    type: 'chat',
  },
  {
    description:
      'Skylark 2nd-gen model. Skylark2-lite has fast responses for real-time, cost-sensitive scenarios with lower accuracy needs, with an 8K context window.',
    displayName: 'Skylark2-lite-8k',
    id: 'Skylark2-lite-8k',
    type: 'chat',
  },
];

export const allModels = [...higressChatModels];

export default allModels;
