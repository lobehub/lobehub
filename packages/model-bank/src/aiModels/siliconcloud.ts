import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

// https://siliconflow.cn/zh-cn/models
const siliconcloudChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.5 is an open-source native multimodal agent model, built on Kimi-K2-Base, trained on approximately 1.5 trillion mixed vision and text tokens. The model adopts an MoE architecture with 1T total parameters and 32B active parameters, supporting a 256K context window, seamlessly integrating vision and language understanding capabilities.',
    displayName: 'Kimi-K2.5 (Pro)',
    id: 'Pro/moonshotai/Kimi-K2.5',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 21, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    description:
      'PaddleOCR-VL-1.5 is an upgraded version of the PaddleOCR-VL series, achieving 94.5% accuracy on the OmniDocBench v1.5 document parsing benchmark, surpassing leading general large models and specialized document parsing models. It innovatively supports irregular bounding box localization for document elements, handling scanned, tilted, and screen-captured images effectively.',
    displayName: 'PaddleOCR-VL 1.5',
    id: 'PaddlePaddle/PaddleOCR-VL-1.5',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-29',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 192_000,
    description:
      'MiniMax-M2.1 is an open-source large language model optimized for agent capabilities, excelling in programming, tool usage, instruction following, and long-term planning. The model supports multilingual software development and complex multi-step workflow execution, achieving a score of 74.0 on SWE-bench Verified and surpassing Claude Sonnet 4.5 in multilingual scenarios.',
    displayName: 'MiniMax-M2.1 (Pro)',
    id: 'Pro/MiniMaxAI/MiniMax-M2.1',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's new generation flagship model with 355B total parameters and 32B active parameters, fully upgraded in general dialogue, reasoning, and agent capabilities. GLM-4.7 enhances Interleaved Thinking and introduces Preserved Thinking and Turn-level Thinking.",
    displayName: 'GLM-4.7 (Pro)',
    id: 'Pro/zai-org/glm-4.7',
    pricing: {
      currency: 'CNY',
      units: [
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 0.4,
              '[0, 0.032]_[0.0002, infinity]': 0.6,
              '[0.032, infinity]_[0, infinity]': 0.8,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput_cacheRead',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 2,
              '[0, 0.032]_[0.0002, infinity]': 3,
              '[0.032, infinity]_[0, infinity]': 4,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textInput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
        {
          lookup: {
            prices: {
              '[0, 0.032]_[0, 0.0002]': 8,
              '[0, 0.032]_[0.0002, infinity]': 14,
              '[0.032, infinity]_[0, infinity]': 16,
            },
            pricingParams: ['textInput', 'textOutput'],
          },
          name: 'textOutput',
          strategy: 'lookup',
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2025-12-22',
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
    contextWindowTokens: 262_144,
    description:
      "Kimi K2 Thinking is the latest and most powerful open-source thinking model. It greatly extends multi-step reasoning depth and sustains stable tool use across 200–300 consecutive calls, setting new records on Humanity's Last Exam (HLE), BrowseComp, and other benchmarks. It excels in coding, math, logic, and agent scenarios. Built on an MoE architecture with ~1T total parameters, it supports a 256K context window and tool calling.",
    displayName: 'Kimi K2 Thinking',
    id: 'moonshotai/Kimi-K2-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-07',
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
      'Kimi K2 Thinking Turbo is the Turbo variant optimized for reasoning speed and throughput while retaining K2 Thinking’s multi-step reasoning and tool use. It is an MoE model with ~1T total parameters, native 256K context, and stable large-scale tool calling for production scenarios with stricter latency and concurrency needs.',
    displayName: 'Kimi K2 Thinking (Pro)',
    id: 'Pro/moonshotai/Kimi-K2-Thinking',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 32, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-07',
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
    contextWindowTokens: 128_000,
    description:
      'MiniMax-M2 redefines agent efficiency. It is a compact, fast, cost-effective MoE model with 230B total and 10B active parameters, built for top-tier coding and agent tasks while retaining strong general intelligence. With only 10B active parameters, it rivals much larger models, making it ideal for high-efficiency applications.',
    displayName: 'MiniMax-M2',
    id: 'MiniMaxAI/MiniMax-M2',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-VL-32B-Instruct is a vision-language model from the Qwen team with leading SOTA results on multiple VL benchmarks. It supports megapixel-resolution images and offers strong visual understanding, multilingual OCR, fine-grained visual grounding, and visual dialogue. It handles complex multimodal tasks and supports tool calling and prefix completion.',
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
      'Qwen3-VL-32B-Thinking is optimized for complex visual reasoning. It includes a built-in thinking mode that generates intermediate reasoning steps before answers, boosting multi-step logic, planning, and complex reasoning. It supports megapixel images, strong visual understanding, multilingual OCR, fine-grained grounding, visual dialogue, tool calling, and prefix completion.',
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
      'DeepSeek-OCR is a vision-language model from DeepSeek AI focused on OCR and "context optical compression." It explores compressing context from images, efficiently processes documents, and converts them to structured text (e.g., Markdown). It accurately recognizes text in images, suited for document digitization, text extraction, and structured processing.',
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
      'Qwen3-Omni-30B-A3B-Instruct is a Qwen3-series MoE model with 30B total and 3B active parameters, delivering strong performance at lower inference cost. Trained on high-quality multi-source multilingual data, it supports full-modal inputs (text, images, audio, video) and cross-modal understanding and generation.',
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
      'Qwen3-Omni-30B-A3B-Thinking is the core "Thinker" component of Qwen3-Omni. It processes multimodal inputs (text, audio, images, video) and performs complex chain-of-thought reasoning, unifying inputs into a shared representation for deep cross-modal understanding. It is an MoE model with 30B total and 3B active parameters, balancing strong reasoning and compute efficiency.',
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
      'Qwen3-Omni-30B-A3B-Captioner is a Qwen3-series VLM built for high-quality, detailed, accurate image captions. It uses a 30B-parameter MoE architecture to deeply understand images and produce fluent descriptions, excelling at detail capture, scene understanding, object recognition, and relational reasoning.',
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
      'Hunyuan Translation Model includes Hunyuan-MT-7B and the ensemble Hunyuan-MT-Chimera. Hunyuan-MT-7B is a 7B lightweight translation model supporting 33 languages plus 5 Chinese minority languages. In WMT25 it took 30 first-place results across 31 language pairs. Tencent Hunyuan uses a full training pipeline from pretraining to SFT to translation RL and ensemble RL, achieving leading performance at its size with efficient, easy deployment.',
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
      'KAT-Dev (32B) is an open-source 32B model for software engineering tasks. It achieves a 62.4% solve rate on SWE-Bench Verified, ranking 5th among open models. It is optimized through mid-training, SFT, and RL for code completion, bug fixing, and code review.',
    displayName: 'KAT-Dev 32B',
    id: 'Kwaipilot/KAT-Dev',
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-27',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 198_000,
    description:
      'Compared to GLM-4.5, GLM-4.6 expands context from 128K to 200K for more complex agent tasks. It scores higher on code benchmarks and shows stronger real-world performance in apps like Claude Code, Cline, Roo Code, and Kilo Code, including better frontend page generation. Reasoning is improved and tool use is supported during reasoning, strengthening overall capability. It integrates better into agent frameworks, improves tool/search agents, and has more human-preferred writing style and roleplay naturalness.',
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
      'Qwen3-Next-80B-A3B-Thinking is a next-gen base model for complex reasoning. It uses the Qwen3-Next architecture with hybrid attention (Gated DeltaNet + Gated Attention) and highly sparse MoE for extreme training/inference efficiency. With 80B total parameters but ~3B active at inference, it cuts compute and delivers 10x+ throughput over Qwen3-32B on >32K contexts. This Thinking version targets multi-step tasks like proofs, code synthesis, logic analysis, and planning, outputting structured chain-of-thought. It outperforms Qwen3-32B-Thinking and beats Gemini-2.5-Flash-Thinking on several benchmarks.',
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
      'Qwen3-Next-80B-A3B-Instruct is a next-gen base model using the Qwen3-Next architecture for extreme training and inference efficiency. It combines hybrid attention (Gated DeltaNet + Gated Attention), highly sparse MoE, and training stability optimizations. With 80B total parameters but ~3B active at inference, it reduces compute and delivers 10x+ throughput over Qwen3-32B on >32K contexts. This instruction-tuned version targets general tasks (no Thinking mode). It performs comparably to Qwen3-235B on some benchmarks and shows strong advantages in ultra-long context tasks.',
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
      'Qwen3-VL-30B-A3B-Instruct is the instruction-tuned Qwen3-VL model with strong vision-language understanding and generation. It natively supports 256K context for multimodal chat and image-conditioned generation.',
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
      'Qwen3-VL-30B-A3B-Thinking is the reasoning-enhanced version of Qwen3-VL, optimized for multimodal reasoning, image-to-code, and complex visual understanding. It supports 256K context with stronger chain-of-thought ability.',
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
      'Qwen3-VL-235B-A22B-Instruct is a large instruction-tuned Qwen3-VL model built on MoE, delivering excellent multimodal understanding and generation. It natively supports 256K context and is suitable for high-concurrency production multimodal services.',
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
      'Qwen3-VL-235B-A22B-Thinking is the flagship thinking version of Qwen3-VL, optimized for complex multimodal reasoning, long-context reasoning, and agent interaction in enterprise scenarios.',
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
      'DeepSeek-V3.2-Exp is an experimental V3.2 release bridging to the next architecture. It adds DeepSeek Sparse Attention (DSA) on top of V3.1-Terminus to improve long-context training and inference efficiency, with optimizations for tool use, long-document understanding, and multi-step reasoning. It is ideal for exploring higher reasoning efficiency with large context budgets.',
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
      'DeepSeek-V3.2-Exp is an experimental V3.2 release bridging to the next architecture. It adds DeepSeek Sparse Attention (DSA) on top of V3.1-Terminus to improve long-context training and inference efficiency, with optimizations for tool use, long-document understanding, and multi-step reasoning. It is ideal for exploring higher reasoning efficiency with large context budgets.',
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
      'DeepSeek-V3.1-Terminus is an updated V3.1 model positioned as a hybrid agent LLM. It fixes user-reported issues and improves stability, language consistency, and reduces mixed Chinese/English and abnormal characters. It integrates Thinking and Non-thinking modes with chat templates for flexible switching. It also improves Code Agent and Search Agent performance for more reliable tool use and multi-step tasks.',
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
      'DeepSeek-V3.1-Terminus is an updated V3.1 model positioned as a hybrid agent LLM. It fixes user-reported issues and improves stability, language consistency, and reduces mixed Chinese/English and abnormal characters. It integrates Thinking and Non-thinking modes with chat templates for flexible switching. It also improves Code Agent and Search Agent performance for more reliable tool use and multi-step tasks.',
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
      'Qwen3-VL-8B-Instruct is a Qwen3 vision-language model built on Qwen3-8B-Instruct and trained on large image-text data. It excels at general visual understanding, vision-centric dialogue, and multilingual text recognition in images, suitable for visual QA, captioning, multimodal instruction following, and tool use.',
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
      'Qwen3-VL-8B-Thinking is the visual thinking version of Qwen3, optimized for complex multi-step reasoning. It generates a thinking chain before answers to improve accuracy, ideal for deep visual QA and detailed image analysis.',
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
      'Ring-flash-2.0 is a high-performance thinking model optimized from Ling-flash-2.0-base. It uses an MoE architecture with 100B total parameters and only 6.1B active per inference. Its icepop algorithm stabilizes RL training for MoE models, enabling continued gains in complex reasoning. It achieves major breakthroughs on tough benchmarks (math contests, code generation, logical reasoning), surpassing top dense models under 40B and rivaling larger open MoE and closed reasoning models. It also performs well in creative writing, and its efficient architecture delivers fast inference at lower deployment cost for high concurrency.',
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
      'Ling-flash-2.0 is the third Ling 2.0 architecture model from Ant Group’s Bailing team. It is an MoE model with 100B total parameters but only 6.1B active per token (4.8B non-embedding). Despite its lightweight configuration, it matches or exceeds 40B dense models and even larger MoE models on multiple benchmarks, exploring high efficiency through architecture and training strategy.',
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
      'Ling-mini-2.0 is a small, high-performance MoE LLM with 16B total parameters and only 1.4B active per token (789M non-embedding), delivering very fast generation. With efficient MoE design and large high-quality training data, it achieves top-tier performance comparable to dense models under 10B and larger MoE models.',
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
      'Seed-OSS is a family of open-source LLMs from ByteDance Seed, designed for strong long-context handling, reasoning, agent, and general abilities. Seed-OSS-36B-Instruct is a 36B instruction-tuned model with native ultra-long context for processing large documents or codebases. It is optimized for reasoning, code generation, and agent tasks (tool use) while retaining strong general ability. A key feature is "Thinking Budget," allowing flexible reasoning length to improve efficiency.',
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
      'Step3 is a cutting-edge multimodal reasoning model from StepFun, built on an MoE architecture with 321B total and 38B active parameters. Its end-to-end design minimizes decoding cost while delivering top-tier vision-language reasoning. With MFA and AFD design, it stays efficient on both flagship and low-end accelerators. Pretraining uses 20T+ text tokens and 4T image-text tokens across many languages. It reaches leading open-model performance on math, code, and multimodal benchmarks.',
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
      'Qwen3-Coder-480B-A35B-Instruct is Alibaba’s most agentic code model to date. It is an MoE model with 480B total and 35B active parameters, balancing efficiency and performance. It natively supports 256K context and can extend to 1M tokens via YaRN, enabling large codebase handling. Designed for agentic coding workflows, it can interact with tools and environments to solve complex programming tasks. It achieves top open-model results on coding and agent benchmarks, comparable to leading models like Claude Sonnet 4.',
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
      'Qwen3-Coder-30B-A3B-Instruct is a Qwen3 code model from the Qwen team. It is streamlined for high performance and efficiency while boosting code capabilities. It shows strong advantages on agentic coding, automated browser operations, and tool use among open models. It natively supports 256K context and can extend to 1M tokens for codebase-level understanding. It powers agentic coding on platforms like Qwen Code and CLINE with a dedicated function-calling format.',
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
      'GLM-4.5V is Zhipu AI’s latest VLM, built on the GLM-4.5-Air flagship text model (106B total, 12B active) with an MoE architecture for strong performance at lower cost. It follows the GLM-4.1V-Thinking path and adds 3D-RoPE to improve 3D spatial reasoning. Optimized through pretraining, SFT, and RL, it handles images, video, and long documents and ranks top among open models on 41 public multimodal benchmarks. A Thinking mode toggle lets users balance speed and depth.',
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
      'GLM-4.5 is a base model built for agent applications using a Mixture-of-Experts architecture. It is deeply optimized for tool use, web browsing, software engineering, and frontend coding, and integrates with code agents like Claude Code and Roo Code. It uses hybrid reasoning to handle both complex reasoning and everyday scenarios.',
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
      'GLM-4.5-Air is a base model for agent applications using a Mixture-of-Experts architecture. It is optimized for tool use, web browsing, software engineering, and frontend coding, and integrates with code agents like Claude Code and Roo Code. It uses hybrid reasoning to handle both complex reasoning and everyday scenarios.',
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
      'Pangu-Pro-MoE 72B-A16B is a sparse LLM with 72B total and 16B active parameters, based on a grouped MoE (MoGE) architecture. It groups experts during selection and constrains tokens to activate equal experts per group, balancing load and improving deployment efficiency on Ascend.',
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
      'ERNIE-4.5-300B-A47B is a Baidu MoE LLM with 300B total parameters and 47B active per token, balancing strong performance and compute efficiency. As a core ERNIE 4.5 model, it excels at understanding, generation, reasoning, and programming. It uses a multimodal heterogeneous MoE pretraining method with joint text-vision training to boost overall capability, especially instruction following and world knowledge.',
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
      'Kimi K2-Instruct-0905 is the newest and most powerful Kimi K2. It is a top-tier MoE model with 1T total and 32B active parameters. Key features include stronger agentic coding intelligence with significant gains on benchmarks and real-world agent tasks, plus improved frontend coding aesthetics and usability.',
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
      'Kimi K2-Instruct-0905 is the newest and most powerful Kimi K2. It is a top-tier MoE model with 1T total and 32B active parameters. Key features include stronger agentic coding intelligence with significant gains on benchmarks and real-world agent tasks, plus improved frontend coding aesthetics and usability.',
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
      'Kimi-Dev-72B is an open-source code LLM optimized with large-scale RL to produce robust, production-ready patches. It scores 60.4% on SWE-bench Verified, setting a new open-model record for automated software engineering tasks like bug fixing and code review.',
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
      'Hunyuan-A13B-Instruct uses 80B total parameters with 13B active to match larger models. It supports fast/slow hybrid reasoning, stable long-text understanding, and leading agent ability on BFCL-v3 and τ-Bench. GQA and multi-quant formats enable efficient inference.',
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
      'MiniMax-M1 is an open-weights large-scale hybrid-attention reasoning model with 456B total parameters and ~45.9B active per token. It natively supports 1M context and uses Flash Attention to cut FLOPs by 75% on 100K-token generation vs DeepSeek R1. With an MoE architecture plus CISPO and hybrid-attention RL training, it achieves leading performance on long-input reasoning and real software engineering tasks.',
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
      'QwenLong-L1-32B is the first long-context reasoning model (LRM) trained with RL, optimized for long-text reasoning. Its progressive context expansion RL enables stable transfer from short to long context. It surpasses OpenAI-o3-mini and Qwen3-235B-A22B on seven long-context document QA benchmarks, rivaling Claude-3.7-Sonnet-Thinking. It is especially strong at math, logic, and multi-hop reasoning.',
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
      'Qwen3-235B-A22B-Thinking-2507 is a Qwen3 model focused on hard complex reasoning. It uses an MoE architecture with 235B total and ~22B active per token to boost efficiency. As a dedicated thinking model, it shows major gains in logic, math, science, coding, and academic benchmarks, reaching top-tier open thinking performance. It also improves instruction following, tool use, and text generation, and natively supports 256K context for deep reasoning and long documents.',
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
      'Qwen3-235B-A22B-Instruct-2507 is a flagship Qwen3 MoE model with 235B total and 22B active parameters. It is an updated non-thinking version focused on improving instruction following, logical reasoning, text understanding, math, science, coding, and tool use. It also expands multilingual long-tail knowledge and better aligns with user preferences for subjective open-ended tasks.',
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
      'Qwen3-30B-A3B-Thinking-2507 is the latest thinking model in the Qwen3 series. It is an MoE model with 30.5B total and 3.3B active parameters, focused on complex tasks. It shows significant gains in logic, math, science, coding, and academic benchmarks, and improves instruction following, tool use, text generation, and preference alignment. It natively supports 256K context and can extend to 1M tokens. This version is designed for thinking mode with detailed step-by-step reasoning and strong agent capabilities.',
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
      'Qwen3-30B-A3B-Instruct-2507 is the updated non-thinking version of Qwen3-30B-A3B. It is an MoE model with 30.5B total and 3.3B active parameters. It significantly improves instruction following, logical reasoning, text understanding, math, science, coding, and tool use, expands multilingual long-tail knowledge, and better aligns with user preferences on subjective open tasks. It supports 256K context. This model is non-thinking only and will not output `<think></think>` tags.',
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
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capability, and multilingual performance, and supports switching thinking modes.',
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
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capability, and multilingual performance, and supports switching thinking modes.',
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
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capability, and multilingual performance, and supports switching thinking modes.',
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
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capability, and multilingual performance, and supports switching thinking modes.',
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
      'Qwen3 is a next-gen Tongyi Qwen model with major gains in reasoning, general ability, agent capability, and multilingual performance, and supports switching thinking modes.',
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
      'GLM-4.1V-9B-Thinking is an open-source VLM from Zhipu AI and Tsinghua KEG Lab, designed for complex multimodal cognition. Built on GLM-4-9B-0414, it adds chain-of-thought reasoning and RL to significantly improve cross-modal reasoning and stability.',
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
      'GLM-4.1V-9B-Thinking is an open-source VLM from Zhipu AI and Tsinghua KEG Lab, designed for complex multimodal cognition. Built on GLM-4-9B-0414, it adds chain-of-thought reasoning and RL to significantly improve cross-modal reasoning and stability.',
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
      'GLM-Z1-Rumination-32B-0414 is a deep reasoning model with rumination capabilities (benchmarked against OpenAI Deep Research). Unlike typical deep-thinking models, it spends longer deliberation to solve more open and complex problems.',
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
      'GLM-Z1-32B-0414 is a deep-thinking reasoning model built from GLM-4-32B-0414 with cold-start data and expanded RL, further trained on math, code, and logic. It significantly improves math ability and complex task solving over the base model.',
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
      'GLM-Z1-9B-0414 is a small 9B-parameter GLM model that retains open-source strengths while delivering impressive capability. It performs strongly on math reasoning and general tasks, leading its size class among open models.',
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
      'GLM-4-32B-0414 is a next-gen open GLM model with 32B parameters, comparable to OpenAI GPT and DeepSeek V3/R1 series in performance.',
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
      'GLM-4-9B-0414 is a 9B GLM model that inherits GLM-4-32B techniques while offering a lighter deployment. It performs well in code generation, web design, SVG generation, and search-based writing.',
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
      'GLM-4-9B-Chat is the open-source GLM-4 model from Zhipu AI. It performs strongly across semantics, math, reasoning, code, and knowledge. Beyond multi-turn chat, it supports web browsing, code execution, custom tool calls, and long-text reasoning. It supports 26 languages (including Chinese, English, Japanese, Korean, German). It performs well on AlignBench-v2, MT-Bench, MMLU, and C-Eval, and supports up to 128K context for academic and business use.',
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
      'GLM-4-9B-Chat is the open-source GLM-4 model from Zhipu AI. It performs strongly across semantics, math, reasoning, code, and knowledge. Beyond multi-turn chat, it supports web browsing, code execution, custom tool calls, and long-text reasoning. It supports 26 languages (including Chinese, English, Japanese, Korean, German). It performs well on AlignBench-v2, MT-Bench, MMLU, and C-Eval, and supports up to 128K context for academic and business use.',
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
      'DeepSeek-R1-0528-Qwen3-8B distills chain-of-thought from DeepSeek-R1-0528 into Qwen3 8B Base. It reaches SOTA among open models, beating Qwen3 8B by 10% on AIME 2024 and matching Qwen3-235B-thinking performance. It excels on math reasoning, programming, and general logic benchmarks. It shares the Qwen3-8B architecture but uses the DeepSeek-R1-0528 tokenizer.',
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
      'DeepSeek-R1 is an RL-driven reasoning model that reduces repetition and improves readability. It uses cold-start data before RL to further boost reasoning, matches OpenAI-o1 on math, code, and reasoning tasks, and improves overall results through careful training.',
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
      'DeepSeek-V3 is a 671B-parameter MoE model using MLA and DeepSeekMoE with loss-free load balancing for efficient inference and training. Pretrained on 14.8T high-quality tokens and further tuned with SFT and RL, it outperforms other open models and approaches leading closed models.',
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
      'DeepSeek-R1 is an RL-driven reasoning model that reduces repetition and improves readability. It uses cold-start data before RL to further boost reasoning, matches OpenAI-o1 on math, code, and reasoning tasks, and improves overall results through careful training.',
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
      'DeepSeek-V3 is a 671B-parameter MoE model using MLA and DeepSeekMoE with loss-free load balancing for efficient inference and training. Pretrained on 14.8T high-quality tokens and further tuned with SFT and RL, it outperforms other open models and approaches leading closed models.',
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
      'DeepSeek-R1-Distill-Qwen-32B is distilled from Qwen2.5-32B and fine-tuned on 800K curated DeepSeek-R1 samples. It excels in math, programming, and reasoning, achieving strong results on AIME 2024, MATH-500 (94.3% accuracy), and GPQA Diamond.',
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
      'DeepSeek-R1-Distill-Qwen-14B is distilled from Qwen2.5-14B and fine-tuned on 800K curated DeepSeek-R1 samples. It shows strong reasoning, with 93.9% on MATH-500, 69.7% on AIME 2024, and a 1481 CodeForces rating.',
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
      'DeepSeek-R1-Distill-Qwen-7B is distilled from Qwen2.5-Math-7B and fine-tuned on 800K curated DeepSeek-R1 samples. It performs strongly, with 92.8% on MATH-500, 55.5% on AIME 2024, and a 1189 CodeForces rating for a 7B model.',
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
      'DeepSeek-R1-Distill-Qwen-7B is distilled from Qwen2.5-Math-7B and fine-tuned on 800K curated DeepSeek-R1 samples. It performs strongly, with 92.8% on MATH-500, 55.5% on AIME 2024, and a 1189 CodeForces rating for a 7B model.',
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
      'DeepSeek-V2.5 upgrades DeepSeek-V2-Chat and DeepSeek-Coder-V2-Instruct, combining general and coding abilities. It improves writing and instruction following for better preference alignment, and shows significant gains on AlpacaEval 2.0, ArenaHard, AlignBench, and MT-Bench.',
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
      'DeepSeek-VL2 is a MoE vision-language model based on DeepSeekMoE-27B with sparse activation, achieving strong performance with only 4.5B active parameters. It excels at visual QA, OCR, document/table/chart understanding, and visual grounding.',
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
      'QVQ-72B-Preview is a research model from Qwen focused on visual reasoning, with strengths in complex scene understanding and visual math problems.',
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
      'QwQ is a reasoning model in the Qwen family. Compared with standard instruction-tuned models, it adds thinking and reasoning that significantly boost downstream performance, especially on hard problems. QwQ-32B is a mid-size reasoning model competitive with top reasoning models like DeepSeek-R1 and o1-mini. It uses RoPE, SwiGLU, RMSNorm, and attention QKV bias, with 64 layers and 40 Q attention heads (8 KV in GQA).',
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
      'Qwen2.5-7B-Instruct is part of Alibaba Cloud’s latest LLM series. The 7B model brings notable gains in coding and math, supports 29+ languages, and improves instruction following, structured data understanding, and structured output (especially JSON).',
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
      'Qwen2.5-7B-Instruct is part of Alibaba Cloud’s latest LLM series. The 7B model brings notable gains in coding and math, supports 29+ languages, and improves instruction following, structured data understanding, and structured output (especially JSON).',
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
      'Qwen2.5-14B-Instruct is part of Alibaba Cloud’s latest LLM series. The 14B model brings notable gains in coding and math, supports 29+ languages, and improves instruction following, structured data understanding, and structured output (especially JSON).',
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
      'Qwen2.5-32B-Instruct is part of Alibaba Cloud’s latest LLM series. The 32B model brings notable gains in coding and math, supports 29+ languages, and improves instruction following, structured data understanding, and structured output (especially JSON).',
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
      'Qwen2.5-72B-Instruct is part of Alibaba Cloud’s latest LLM series. The 72B model brings notable gains in coding and math, supports 29+ languages, and improves instruction following, structured data understanding, and structured output (especially JSON).',
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
      'Qwen2.5-72B-Instruct is part of Alibaba Cloud’s latest LLM series. The 72B model improves coding and math, supports up to 128K input and over 8K output, offers 29+ languages, and improves instruction following and structured output (especially JSON).',
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
      'Qwen2.5-Coder-7B-Instruct is the latest Alibaba Cloud code-focused LLM. Built on Qwen2.5 and trained on 5.5T tokens, it significantly improves code generation, reasoning, and repair while retaining math and general strengths, providing a solid base for coding agents.',
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
      'Qwen2.5-Coder-7B-Instruct is the latest Alibaba Cloud code-focused LLM. Built on Qwen2.5 and trained on 5.5T tokens, it significantly improves code generation, reasoning, and repair while retaining math and general strengths, providing a solid base for coding agents.',
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
      'Qwen2.5-Coder-32B-Instruct is a code-focused model built on Qwen2.5. Trained on 5.5T tokens, it significantly improves code generation, reasoning, and repair. It is among the most advanced open code models, with coding ability comparable to GPT-4, while retaining math and general strengths and supporting long text.',
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
      'Qwen2-7B-Instruct is a 7B instruction-tuned LLM in the Qwen2 series. It uses Transformer architecture with SwiGLU, attention QKV bias, and grouped-query attention, and handles large inputs. It performs strongly across language understanding, generation, multilingual tasks, coding, math, and reasoning, outperforming most open models and competing with proprietary ones. It surpasses Qwen1.5-7B-Chat on multiple benchmarks.',
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
      'Qwen2-7B-Instruct is a 7B instruction-tuned LLM in the Qwen2 series. It uses Transformer architecture with SwiGLU, attention QKV bias, and grouped-query attention, and handles large inputs. It performs strongly across language understanding, generation, multilingual tasks, coding, math, and reasoning, outperforming most open models and competing with proprietary ones. It surpasses Qwen1.5-7B-Chat on multiple benchmarks.',
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
      'Qwen2-VL is the latest Qwen-VL model, reaching SOTA on vision benchmarks like MathVista, DocVQA, RealWorldQA, and MTVQA. It can understand videos over 20 minutes for video QA, dialogue, and content creation. It also supports complex reasoning and decision-making, integrating with devices/robots for vision-driven actions. Beyond English and Chinese, it can read text in many languages including most European languages, Japanese, Korean, Arabic, and Vietnamese.',
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
      'Qwen2.5-VL is a new Qwen vision-language model with strong visual understanding. It analyzes text, charts, and layouts in images, understands long videos and events, supports reasoning and tool use, multi-format object grounding, and structured outputs. It improves dynamic resolution and frame-rate training for video understanding and boosts vision encoder efficiency.',
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
      'Qwen2.5-VL-32B-Instruct is a multimodal model from the Qwen team. It recognizes common objects and analyzes text, charts, icons, graphics, and layouts. As a visual agent, it can reason and dynamically control tools, including computer and phone use. It precisely localizes objects and generates structured outputs for invoices and tables. Compared to Qwen2-VL, RL further improves math and problem-solving, with more human-preferred responses.',
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
      'Qwen2.5-VL is the vision-language model in the Qwen2.5 series with major upgrades: stronger visual understanding for objects, text, charts, and layouts; reasoning as a visual agent with dynamic tool use; understanding videos over 1 hour and capturing key events; precise object grounding via boxes or points; and structured outputs for scanned data like invoices and tables.',
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
      'InternLM2.5-7B-Chat is an open-source chat model based on the InternLM2 architecture. The 7B model focuses on dialogue generation with Chinese/English support, using modern training for fluent, intelligent conversation. It suits many chat scenarios such as customer support and personal assistants.',
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
      'Kolors is a large-scale latent-diffusion text-to-image model by the Kuaishou Kolors team. Trained on billions of text-image pairs, it excels in visual quality, complex semantic accuracy, and Chinese/English text rendering, with strong Chinese content understanding and generation.',
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
      'Qwen-Image is a 20B-parameter image generation foundation model from the Qwen team. It makes major gains in complex text rendering and precise image editing, especially for high-fidelity Chinese/English text. It supports multi-line and paragraph layouts while keeping typography coherent. Beyond text rendering, it supports a wide range of styles from photorealistic to anime, and advanced editing like style transfer, object add/remove, detail enhancement, text editing, and pose control, aiming to be a comprehensive visual creation foundation.',
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
      'Qwen-Image-Edit-2509 is the latest editing version of Qwen-Image from the Qwen team. Built on the 20B Qwen-Image model, it extends strong text rendering into image editing for precise text edits. It uses a dual-control architecture, sending inputs to Qwen2.5-VL for semantic control and a VAE encoder for appearance control, enabling both semantic- and appearance-level editing. It supports local edits (add/remove/modify) and higher-level semantic edits like IP creation and style transfer while preserving semantics. It achieves SOTA results on multiple benchmarks.',
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
