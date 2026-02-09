import { AIChatModelCard } from '../types/aiModel';

const bedrockChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.6 is Anthropic's most intelligent model for building agents and coding.",
    displayName: 'Claude Opus 4.6',
    enabled: true,
    id: 'us.anthropic.claude-opus-4-6-v1',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        {
          lookup: { prices: { '1h': 10, '5m': 6.25 }, pricingParams: ['ttl'] },
          name: 'textInput_cacheWrite',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['disableContextCaching', 'enableAdaptiveThinking', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Opus 4.5 is Anthropic's flagship model, combining exceptional intelligence and scalable performance for complex tasks requiring the highest-quality responses and reasoning.",
    displayName: 'Claude Opus 4.5',
    enabled: true,
    id: 'global.anthropic.claude-opus-4-5-20251101-v1:0',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description: "Claude Sonnet 4.5 is Anthropic's most intelligent model to date.",
    displayName: 'Claude Sonnet 4.5',
    enabled: true,
    id: 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-29',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude Haiku 4.5 is Anthropic's fastest and most intelligent Haiku model, with lightning speed and extended thinking.",
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    id: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  /*
    // TODO: Not support for now
    {
      description: 'Amazon Titan Text Lite is a lightweight, efficient model ideal for fine-tuning English tasks like summarization and copywriting, offering a smaller, more economical, and highly customizable option.',
      displayName: 'Titan Text G1 - Lite',
      id: 'amazon.titan-text-lite-v1',
      tokens: 4000,
    },
    {
      description: 'Amazon Titan Text Express supports up to 8,000 tokens and is ideal for advanced general language tasks such as open-ended generation, chat, and RAG. At launch it was optimized for English, with preview support for 100+ other languages.',
      displayName: 'Titan Text G1 - Express',
      id: 'amazon.titan-text-express-v1',
      tokens: 8000,
    },
    {
      description: 'Titan Text Premier is a powerful advanced model in the Titan Text family, built for enterprise-grade performance. Its cutting-edge capabilities deliver higher accuracy and superior results for top-tier text processing.',
      displayName: 'Titan Text G1 - Premier',
      id: 'amazon.titan-text-premier-v1:0',
      tokens: 32_000,
    },
*/
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      "Claude 3.7 Sonnet is Anthropic's fastest next-gen model. Compared to Claude 3 Haiku, it improves across skills and surpasses the previous flagship Claude 3 Opus on many intelligence benchmarks.",
    displayName: 'Claude 3.7 Sonnet',
    id: 'us.anthropic.claude-3-7-sonnet-20250219-v1:0',
    maxOutput: 64_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-02-24',
    settings: {
      extendParams: ['disableContextCaching', 'enableReasoning', 'reasoningBudgetToken'],
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
      'Claude 3.5 Sonnet raises the industry standard, outperforming competitors and Claude 3 Opus across broad evaluations while keeping mid-tier speed and cost.',
    displayName: 'Claude 3.5 Sonnet',
    id: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-22',
    settings: {
      extendParams: ['disableContextCaching'],
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
      'Claude 3.5 Sonnet raises the industry standard, outperforming competitors and Claude 3 Opus across broad evaluations while keeping mid-tier speed and cost.',
    displayName: 'Claude 3.5 Sonnet v2 (Inference profile)',
    id: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-10-22',
    settings: {
      extendParams: ['disableContextCaching'],
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
      'Claude 3.5 Sonnet raises the industry standard, outperforming competitors and Claude 3 Opus across broad evaluations while keeping mid-tier speed and cost.',
    displayName: 'Claude 3.5 Sonnet 0620',
    id: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
    maxOutput: 8192,
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-06-20',
    settings: {
      extendParams: ['disableContextCaching'],
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
      'Claude 3 Haiku is Anthropic’s fastest, most compact model, delivering near-instant responses for simple queries. It enables seamless, human-like AI experiences and supports image input with a 200K context window.',
    displayName: 'Claude 3 Haiku',
    id: 'anthropic.claude-3-haiku-20240307-v1:0',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-03-07',
    settings: {
      extendParams: ['disableContextCaching'],
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
      'Claude 3 Sonnet balances intelligence and speed for enterprise workloads, offering strong value at lower cost. It is designed as a reliable workhorse for scaled AI deployments and supports image input with a 200K context window.',
    displayName: 'Claude 3 Sonnet',
    id: 'anthropic.claude-3-sonnet-20240229-v1:0',
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
    contextWindowTokens: 200_000,
    description:
      'Claude 3 Opus is Anthropic’s most powerful AI model with state-of-the-art performance on highly complex tasks. It handles open-ended prompts and novel scenarios with exceptional fluency and human-like understanding, and supports image input with a 200K context window.',
    displayName: 'Claude 3 Opus',
    id: 'anthropic.claude-3-opus-20240229-v1:0',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-02-29',
    settings: {
      extendParams: ['disableContextCaching'],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 200_000,
    description:
      'An updated Claude 2 with double the context window and improved reliability, hallucination rate, and evidence-based accuracy for long documents and RAG.',
    displayName: 'Claude 2.1',
    id: 'anthropic.claude-v2:1',
    pricing: {
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 100_000,
    description:
      'A highly capable model across tasks from complex dialogue and creative generation to detailed instruction following.',
    displayName: 'Claude 2.0',
    id: 'anthropic.claude-v2',
    pricing: {
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 24, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 100_000,
    description:
      'A fast, economical, yet capable model for everyday chat, text analysis, summarization, and document Q&A.',
    displayName: 'Claude Instant',
    id: 'anthropic.claude-instant-v1',
    maxOutput: 4096,
    pricing: {
      units: [
        { name: 'textInput', rate: 0.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.4, strategy: 'fixed', unit: 'millionTokens' },
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
      'An updated Meta Llama 3.1 8B Instruct with a 128K context window, multilingual support, and improved reasoning. The Llama 3.1 family includes 8B, 70B, and 405B instruction-tuned text models optimized for multilingual chat and strong benchmark performance. It is designed for commercial and research use across languages; instruction-tuned models suit assistant-style chat, while pretrained models fit broader generation tasks. Llama 3.1 outputs can also be used to improve other models (e.g., synthetic data and refinement). It is an autoregressive Transformer model, with SFT and RLHF to align for helpfulness and safety.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta.llama3-1-8b-instruct-v1:0',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
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
      'An updated Meta Llama 3.1 70B Instruct with an extended 128K context window, multilingual support, and improved reasoning. The Llama 3.1 multilingual LLMs are a set of pre-trained and instruction-tuned generation models in 8B, 70B, and 405B sizes (text in/text out). The instruction-tuned text models are optimized for multilingual dialogue and outperform many available open chat models on common industry benchmarks. Llama 3.1 is designed for commercial and research use across languages. Instruction-tuned models are suited for assistant-style chat, while pretrained models fit broader natural language generation tasks. Llama 3.1 outputs can also be used to improve other models, including synthetic data generation and refinement. Llama 3.1 is an autoregressive Transformer model with an optimized architecture. The tuned versions use supervised fine-tuning (SFT) and reinforcement learning from human feedback (RLHF) to align with human preferences for helpfulness and safety.',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'meta.llama3-1-70b-instruct-v1:0',
    pricing: {
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
    description:
      'Meta Llama 3.1 405B Instruct is the largest and most powerful Llama 3.1 Instruct model, a highly advanced model for dialogue reasoning and synthetic data generation, and a strong base for domain-specific continued pretraining or fine-tuning. The Llama 3.1 multilingual LLMs are a set of pre-trained and instruction-tuned generation models in 8B, 70B, and 405B sizes (text in/text out). The instruction-tuned text models are optimized for multilingual dialogue and outperform many available open chat models on common industry benchmarks. Llama 3.1 is designed for commercial and research use across languages. Instruction-tuned models are suited for assistant-style chat, while pretrained models fit broader natural language generation tasks. Llama 3.1 outputs can also be used to improve other models, including synthetic data generation and refinement. Llama 3.1 is an autoregressive Transformer model with an optimized architecture. The tuned versions use supervised fine-tuning (SFT) and reinforcement learning from human feedback (RLHF) to align with human preferences for helpfulness and safety.',
    displayName: 'Llama 3.1 405B Instruct',
    id: 'meta.llama3-1-405b-instruct-v1:0',
    pricing: {
      units: [
        { name: 'textInput', rate: 5.32, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      'Meta Llama 3 is an open LLM for developers, researchers, and enterprises, designed to help them build, experiment, and responsibly scale generative AI ideas. As part of the foundation for global community innovation, it is well suited to limited compute and resources, edge devices, and faster training times.',
    displayName: 'Llama 3 8B Instruct',
    id: 'meta.llama3-8b-instruct-v1:0',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8000,
    description:
      'Meta Llama 3 is an open LLM for developers, researchers, and enterprises, designed to help them build, experiment, and responsibly scale generative AI ideas. As part of the foundation for global community innovation, it is well suited for content creation, conversational AI, language understanding, R&D, and enterprise applications.',
    displayName: 'Llama 3 70B Instruct',
    id: 'meta.llama3-70b-instruct-v1:0',
    pricing: {
      units: [
        { name: 'textInput', rate: 2.65, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...bedrockChatModels];

export default allModels;
