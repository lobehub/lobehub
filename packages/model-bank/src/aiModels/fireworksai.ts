import type { AIChatModelCard } from '../types/aiModel';

const fireworksaiChatModels: AIChatModelCard[] = [
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.3 70B Instruct is the December update to Llama 3.1 70B. It improves tool use, multilingual text support, math, and coding over the July 2024 release. It reaches industry-leading performance in reasoning, math, and instruction following, offering performance comparable to 3.1 405B with significant speed and cost advantages.',
    displayName: 'Llama 3.3 70B Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.2 3B Instruct is a lightweight multilingual model from Meta, designed for efficient runtime with significant latency and cost advantages over larger models. Typical use cases include query/prompt rewriting and writing assistance.',
    displayName: 'Llama 3.2 3B Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/llama-v3p2-3b-instruct',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'An instruction-tuned vision reasoning model from Meta with 11B parameters, optimized for visual recognition, image reasoning, captioning, and image-related Q&A. It understands visual data such as charts and graphs and bridges vision and language by generating textual descriptions of image details.',
    displayName: 'Llama 3.2 11B Vision Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/llama-v3p2-11b-vision-instruct',
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
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'An instruction-tuned vision reasoning model from Meta with 90B parameters, optimized for visual recognition, image reasoning, captioning, and image-related Q&A. It understands visual data such as charts and graphs and bridges vision and language by generating textual descriptions of image details. Note: this model is currently provided experimentally as a serverless model. For production use, note that Fireworks may retire the deployment on short notice.',
    displayName: 'Llama 3.2 90B Vision Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/llama-v3p2-90b-vision-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Meta Llama 3.1 is a multilingual LLM family with pre-trained and instruction-tuned generation models at 8B, 70B, and 405B sizes. The instruction-tuned text models are optimized for multilingual dialogue and outperform many existing open and closed chat models on common industry benchmarks.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
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
    contextWindowTokens: 131_072,
    description:
      'Meta Llama 3.1 is a multilingual LLM family with pre-trained and instruction-tuned generation models at 8B, 70B, and 405B sizes. The instruction-tuned text models are optimized for multilingual dialogue and outperform many existing open and closed chat models on common industry benchmarks.',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'accounts/fireworks/models/llama-v3p1-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
      'Meta Llama 3.1 is a multilingual LLM family with pre-trained and instruction-tuned generation models at 8B, 70B, and 405B sizes. The instruction-tuned text models are optimized for multilingual dialogue and outperform many existing open and closed chat models on common industry benchmarks. 405B is the most capable model in the Llama 3.1 family, using FP8 inference that closely matches the reference implementation.',
    displayName: 'Llama 3.1 405B Instruct',
    id: 'accounts/fireworks/models/llama-v3p1-405b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Meta developed and released the Meta Llama 3 LLM series, a collection of pre-trained and instruction-tuned text generation models at 8B and 70B. The Llama 3 instruction-tuned models are optimized for conversational use and outperform many existing open chat models on common industry benchmarks.',
    displayName: 'Llama 3 8B Instruct',
    id: 'accounts/fireworks/models/llama-v3-8b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Meta developed and released the Meta Llama 3 LLM series, which includes pre-trained and instruction-tuned text generation models at 8B and 70B. The Llama 3 instruction-tuned models are optimized for conversational use and outperform many existing open chat models on common industry benchmarks.',
    displayName: 'Llama 3 70B Instruct',
    id: 'accounts/fireworks/models/llama-v3-70b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'The Meta Llama 3 instruction-tuned models are optimized for conversational use and outperform many existing open chat models on common industry benchmarks. Llama 3 8B Instruct (HF version) is the original FP16 version of Llama 3 8B Instruct, with results expected to match the official Hugging Face implementation.',
    displayName: 'Llama 3 8B Instruct (HF version)',
    id: 'accounts/fireworks/models/llama-v3-8b-instruct-hf',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'A 24B-parameter model with state-of-the-art capability comparable to larger models.',
    displayName: 'Mistral Small 3 Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/mistral-small-24b-instruct-2501',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mixtral MoE 8x7B Instruct is the instruction-tuned version of Mixtral MoE 8x7B, with the chat completion API enabled.',
    displayName: 'Mixtral MoE 8x7B Instruct',
    id: 'accounts/fireworks/models/mixtral-8x7b-instruct',
    pricing: {
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
    },
    contextWindowTokens: 65_536,
    description:
      'Mixtral MoE 8x22B Instruct v0.1 is the instruction-tuned version of Mixtral MoE 8x22B v0.1, with the chat completion API enabled.',
    displayName: 'Mixtral MoE 8x22B Instruct',
    id: 'accounts/fireworks/models/mixtral-8x22b-instruct',
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
      vision: true,
    },
    contextWindowTokens: 32_064,
    description:
      'Phi-3-Vision-128K-Instruct is a lightweight, state-of-the-art open multimodal model built from synthetic data and curated public web datasets, focusing on high-quality, reasoning-intensive text and vision data. It belongs to the Phi-3 family, with a multimodal version supporting a 128K context length (in tokens). The model undergoes rigorous enhancement, including supervised fine-tuning and direct preference optimization, to ensure accurate instruction following and strong safety measures.',
    displayName: 'Phi 3.5 Vision Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/phi-3-vision-128k-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'An improved variant of MythoMix, possibly its more refined form, merging MythoLogic-L2 and Huginn with a highly experimental tensor-type merge technique. Its unique nature makes it excellent for storytelling and roleplay.',
    displayName: 'MythoMax L2 13b',
    id: 'accounts/fireworks/models/mythomax-l2-13b',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'A powerful Mixture-of-Experts (MoE) language model from DeepSeek with 671B total parameters and 37B active parameters per token.',
    displayName: 'Deepseek V3',
    enabled: true,
    id: 'accounts/fireworks/models/deepseek-v3',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
      'DeepSeek-R1 is a state-of-the-art LLM optimized with reinforcement learning and cold-start data, delivering excellent reasoning, math, and coding performance.',
    displayName: 'Deepseek R1',
    enabled: true,
    id: 'accounts/fireworks/models/deepseek-r1',
    pricing: {
      units: [
        { name: 'textInput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8, strategy: 'fixed', unit: 'millionTokens' },
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
      'The Qwen QwQ model focuses on advancing AI reasoning, demonstrating that open models can rival closed frontier models in reasoning. QwQ-32B-Preview is an experimental release that matches o1 and surpasses GPT-4o and Claude 3.5 Sonnet on reasoning and analysis across GPQA, AIME, MATH-500, and LiveCodeBench. Note: this model is currently provided experimentally as a serverless model. For production use, note that Fireworks may retire the deployment on short notice.',
    displayName: 'Qwen Qwq 32b Preview',
    enabled: true,
    id: 'accounts/fireworks/models/qwen-qwq-32b-preview',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 is a decoder-only LLM series developed by the Qwen team and Alibaba Cloud, offering 0.5B, 1.5B, 3B, 7B, 14B, 32B, and 72B sizes, with both base and instruction-tuned variants.',
    displayName: 'Qwen2.5 72B Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/qwen2p5-72b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
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
      'The 72B Qwen-VL model is Alibaba’s latest iteration, reflecting nearly a year of innovation.',
    displayName: 'Qwen2 VL 72B Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/qwen2-vl-72b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5-Coder is the latest Qwen LLM designed for code (formerly CodeQwen). Note: this model is currently provided experimentally as a serverless model. For production use, note that Fireworks may retire the deployment on short notice.',
    displayName: 'Qwen2.5-Coder-32B-Instruct',
    enabled: true,
    id: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
    pricing: {
      units: [
        { name: 'textInput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.9, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Yi-Large is a top-tier LLM that ranks just below GPT-4, Gemini 1.5 Pro, and Claude 3 Opus on the LMSYS leaderboard. It excels in multilingual capability, especially Spanish, Chinese, Japanese, German, and French. Yi-Large is also developer-friendly, using the same API schema as OpenAI for easy integration.',
    displayName: 'Yi-Large',
    enabled: true,
    id: 'accounts/yi-01-ai/models/yi-large',
    pricing: {
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    type: 'chat',
  },
];

export const allModels = [...fireworksaiChatModels];

export default allModels;
