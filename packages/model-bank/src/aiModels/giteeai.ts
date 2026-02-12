import type { AIChatModelCard, AIImageModelCard } from '../types/aiModel';

const giteeaiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A DeepSeek-R1 distilled model based on Qwen2.5-Math-1.5B. Reinforcement learning and cold-start data optimize reasoning performance, setting new multi-task benchmarks for open models.',
    displayName: 'DeepSeek R1 Distill Qwen 1.5B',
    enabled: true,
    id: 'DeepSeek-R1-Distill-Qwen-1.5B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A DeepSeek-R1 distilled model based on Qwen2.5-Math-7B. Reinforcement learning and cold-start data optimize reasoning performance, setting new multi-task benchmarks for open models.',
    displayName: 'DeepSeek R1 Distill Qwen 7B',
    enabled: true,
    id: 'DeepSeek-R1-Distill-Qwen-7B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'A DeepSeek-R1 distilled model based on Qwen2.5-14B. Reinforcement learning and cold-start data optimize reasoning performance, setting new multi-task benchmarks for open models.',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    enabled: true,
    id: 'DeepSeek-R1-Distill-Qwen-14B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'The DeepSeek-R1 series improves reasoning performance with reinforcement learning and cold-start data, setting new multi-task benchmarks for open models and surpassing OpenAI o1-mini.',
    displayName: 'DeepSeek R1 Distill Qwen 32B',
    enabled: true,
    id: 'DeepSeek-R1-Distill-Qwen-32B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_000,
    description:
      'QwQ-32B-Preview is an innovative NLP model that efficiently handles complex dialogue generation and context understanding.',
    displayName: 'QwQ 32B Preview',
    enabled: true,
    id: 'QwQ-32B-Preview',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 16_000,
    description:
      'Qwen2.5-72B-Instruct supports 16k context and generates long text beyond 8K. It supports function calling and seamless external system integration, greatly improving flexibility and extensibility. The model has significantly more knowledge and much stronger coding and math capabilities, with support for 29+ languages.',
    displayName: 'Qwen2.5 72B Instruct',
    enabled: true,
    id: 'Qwen2.5-72B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Qwen2.5-32B-Instruct is a 32B-parameter LLM with balanced performance, optimized for Chinese and multilingual scenarios, supporting intelligent Q&A and content generation.',
    displayName: 'Qwen2.5 32B Instruct',
    enabled: true,
    id: 'Qwen2.5-32B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 24_000,
    description:
      'Qwen2.5-14B-Instruct is a 14B-parameter LLM with strong performance, optimized for Chinese and multilingual scenarios, supporting intelligent Q&A and content generation.',
    displayName: 'Qwen2.5 14B Instruct',
    enabled: true,
    id: 'Qwen2.5-14B-Instruct',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Qwen2.5-7B-Instruct is a 7B-parameter LLM that supports function calling and seamless external system integration, greatly improving flexibility and extensibility. It is optimized for Chinese and multilingual scenarios, supporting intelligent Q&A and content generation.',
    displayName: 'Qwen2.5 7B Instruct',
    enabled: true,
    id: 'Qwen2.5-7B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Qwen2 is the latest Qwen series, supporting a 128k context window. Compared with today’s best open models, Qwen2-72B significantly surpasses leading models in natural language understanding, knowledge, code, math, and multilingual capabilities.',
    displayName: 'Qwen2 72B Instruct',
    id: 'Qwen2-72B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 24_000,
    description:
      'Qwen2 is the latest Qwen series, surpassing the best open models of similar size and even larger models. Qwen2 7B shows significant advantages on multiple benchmarks, especially in code and Chinese understanding.',
    displayName: 'Qwen2 7B Instruct',
    id: 'Qwen2-7B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'Qwen2.5-Coder-32B-Instruct is an LLM designed for code generation, code understanding, and efficient development workflows. With a leading 32B parameter size, it meets diverse programming needs.',
    displayName: 'Qwen2.5 Coder 32B Instruct',
    enabled: true,
    id: 'Qwen2.5-Coder-32B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 24_000,
    description:
      'Qwen2.5-Coder-14B-Instruct is a large-scale pre-trained coding instruction model with strong code understanding and generation. It efficiently handles a wide range of programming tasks, ideal for smart coding, automated script generation, and programming Q&A.',
    displayName: 'Qwen2.5 Coder 14B Instruct',
    enabled: true,
    id: 'Qwen2.5-Coder-14B-Instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'Qwen2-VL-72B is a powerful vision-language model supporting multimodal image-text processing, accurately recognizing image content and generating relevant descriptions or answers.',
    displayName: 'Qwen2 VL 72B',
    enabled: true,
    id: 'Qwen2-VL-72B',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'InternVL2.5-26B is a powerful vision-language model supporting multimodal image-text processing, accurately recognizing image content and generating relevant descriptions or answers.',
    displayName: 'InternVL2.5 26B',
    enabled: true,
    id: 'InternVL2.5-26B',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 32_000,
    description:
      'InternVL2-8B is a powerful vision-language model supporting multimodal image-text processing, accurately recognizing image content and generating relevant descriptions or answers.',
    displayName: 'InternVL2 8B',
    enabled: true,
    id: 'InternVL2-8B',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'GLM-4-9B-Chat performs strongly across semantics, math, reasoning, code, and knowledge. It also supports web browsing, code execution, custom tool calling, and long-text reasoning, with support for 26 languages including Japanese, Korean, and German.',
    displayName: 'GLM4 9B Chat',
    enabled: true,
    id: 'glm-4-9b-chat',
    type: 'chat',
  },
  {
    contextWindowTokens: 4000,
    description:
      'Yi-1.5-34B retains the series’ strong general language abilities while using incremental training on 500B high-quality tokens to significantly improve math logic and coding.',
    displayName: 'Yi 34B Chat',
    enabled: true,
    id: 'Yi-34B-Chat',
    type: 'chat',
  },
  /*
    // not compatible with OpenAI SDK
  {
    description:
      'Code Raccoon is a software intelligent R&D assistant built on SenseTime LLMs, covering requirements analysis, architecture design, coding, and testing. It meets needs like coding and programming learning, supports 90+ mainstream languages (Python, Java, JavaScript, C++, Go, SQL, etc.) and major IDEs such as VS Code and IntelliJ IDEA. In practice, it can boost developer productivity by over 50%.',
    displayName: 'code raccoon v1',
    enabled: true,
    id: 'code-raccoon-v1',
    type: 'chat',
  },
*/
  {
    contextWindowTokens: 8000,
    description:
      'DeepSeek Coder 33B is a code language model trained on 2T tokens (87% code, 13% Chinese/English text). It introduces a 16K context window and fill-in-the-middle tasks, providing project-level code completion and snippet infilling.',
    displayName: 'DeepSeek Coder 33B Instruct',
    enabled: true,
    id: 'deepseek-coder-33B-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_000,
    description:
      'CodeGeeX4-ALL-9B is a multilingual code generation model supporting code completion and generation, code interpreter, web search, function calling, and repo-level code Q&A, covering a wide range of software development scenarios. It is a top-tier code model under 10B parameters.',
    displayName: 'CodeGeeX4 All 9B',
    enabled: true,
    id: 'codegeex4-all-9b',
    type: 'chat',
  },
];

const giteeaiImageModels: AIImageModelCard[] = [
  {
    description:
      'FLUX.1-dev is an open-source multimodal language model (MLLM) from Black Forest Labs, optimized for image-text tasks and combining image/text understanding and generation. Built on advanced LLMs (such as Mistral-7B), it uses a carefully designed vision encoder and multi-stage instruction tuning to enable multimodal coordination and complex task reasoning.',
    displayName: 'FLUX.1-dev',
    enabled: true,
    id: 'FLUX.1-dev',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1536x1536'],
      },
    },
    type: 'image',
  },
  {
    description:
      'A 12B-parameter text-to-image model from Black Forest Labs using latent adversarial diffusion distillation to generate high-quality images in 1-4 steps. It rivals closed alternatives and is released under Apache-2.0 for personal, research, and commercial use.',
    displayName: 'flux-1-schnell',
    enabled: true,
    id: 'flux-1-schnell',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1536x1536', '2048x2048'],
      },
    },
    type: 'image',
  },
  {
    description:
      'FLUX.1-Kontext-dev is a multimodal image generation and editing model from Black Forest Labs based on a Rectified Flow Transformer architecture with 12B parameters. It focuses on generating, reconstructing, enhancing, or editing images under given context conditions. It combines the controllable generation strengths of diffusion models with Transformer context modeling, supporting high-quality outputs for tasks like inpainting, outpainting, and visual scene reconstruction.',
    displayName: 'FLUX.1-Kontext-dev',
    enabled: true,
    id: 'FLUX.1-Kontext-dev',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024', '1536x1536', '2048x2048'],
      },
    },
    type: 'image',
  },
  {
    description:
      'Stable Diffusion 3.5 Large Turbo focuses on high-quality image generation with strong detail rendering and scene fidelity.',
    displayName: 'stable-diffusion-3.5-large-turbo',
    enabled: true,
    id: 'stable-diffusion-3.5-large-turbo',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'The latest text-to-image model from Stability AI. This version significantly improves image quality, text understanding, and style diversity, interpreting complex natural-language prompts more accurately and generating more precise, diverse images.',
    displayName: 'stable-diffusion-3-medium',
    enabled: true,
    id: 'stable-diffusion-3-medium',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'An open-source text-to-image model from Stability AI with industry-leading creative image generation. It has strong instruction understanding and supports reverse prompt definitions for precise generation.',
    displayName: 'stable-diffusion-xl-base-1.0',
    enabled: true,
    id: 'stable-diffusion-xl-base-1.0',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'Kolors is a text-to-image model developed by the Kuaishou Kolors team. Trained with billions of parameters, it has notable advantages in visual quality, Chinese semantic understanding, and text rendering.',
    displayName: 'Kolors',
    enabled: true,
    id: 'Kolors',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'hunyuandit-v1.2-distilled is a lightweight text-to-image model optimized via distillation to generate high-quality images quickly, especially suited for low-resource environments and real-time generation.',
    displayName: 'HunyuanDiT-v1.2-Diffusers-Distilled',
    enabled: true,
    id: 'HunyuanDiT-v1.2-Diffusers-Distilled',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'HiDream-I1 is a new open-source base image generation model released by HiDream. With 17B parameters (Flux has 12B), it can deliver industry-leading image quality in seconds.',
    displayName: 'HiDream-I1-Full',
    enabled: true,
    id: 'HiDream-I1-Full',
    parameters: {
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'HiDream-E1-Full is an open-source multimodal image editing model from HiDream.ai, based on an advanced Diffusion Transformer architecture and strong language understanding (built-in LLaMA 3.1-8B-Instruct). It supports natural-language-driven image generation, style transfer, local edits, and repainting, with excellent image-text understanding and execution.',
    displayName: 'HiDream-E1-Full',
    enabled: true,
    id: 'HiDream-I1-Full',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'HelloMeme is an AI tool that generates memes, GIFs, or short videos from the images or motions you provide. It requires no drawing or coding skills—just a reference image—to produce fun, attractive, and stylistically consistent content.',
    displayName: 'HelloMeme',
    enabled: true,
    id: 'HelloMeme',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'OmniConsistency improves style consistency and generalization in image-to-image tasks by introducing large-scale Diffusion Transformers (DiTs) and paired stylized data, avoiding style degradation.',
    displayName: 'OmniConsistency',
    enabled: true,
    id: 'OmniConsistency',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'InstantCharacter is a tuning-free personalized character generation model released by Tencent AI in 2025, aiming for high-fidelity, cross-scenario consistent character generation. It can model a character from a single reference image and flexibly transfer it across styles, actions, and backgrounds.',
    displayName: 'InstantCharacter',
    enabled: true,
    id: 'InstantCharacter',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'DreamO is an open-source image customization model jointly developed by ByteDance and Peking University, using a unified architecture to support multi-task image generation. It employs efficient compositional modeling to generate highly consistent, customized images based on user-specified identity, subject, style, background, and other conditions.',
    displayName: 'DreamO',
    enabled: true,
    id: 'DreamO',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
  {
    description:
      'AnimeSharp (aka "4x-AnimeSharp") is an open-source super-resolution model based on ESRGAN by Kim2091, focused on upscaling and sharpening anime-style images. It was renamed from "4x-TextSharpV1" in February 2022, originally also for text images but heavily optimized for anime content.',
    displayName: 'AnimeSharp',
    enabled: true,
    id: 'AnimeSharp',
    parameters: {
      imageUrl: { default: null },
      prompt: {
        default: '',
      },
      size: {
        default: '1024x1024',
        enum: ['1024x1024'],
      },
    },
    type: 'image',
  },
];

export const allModels = [...giteeaiChatModels, ...giteeaiImageModels];

export default allModels;
