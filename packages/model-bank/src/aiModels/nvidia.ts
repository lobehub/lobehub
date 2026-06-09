import { type AIChatModelCard } from '../types/aiModel';

const nvidiaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    displayName: 'MiniMax M2.7',
    enabled: true,
    id: 'minimaxai/minimax-m2.7',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    displayName: 'MiniMax M2.5',
    id: 'minimaxai/minimax-m2.5',
    maxOutput: 131_072,
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
      'Kimi K2.6 is a 1T multimodal MoE for long-horizon coding, agentic tool use, and image/video understanding.',
    displayName: 'Kimi K2.6',
    enabled: true,
    id: 'moonshotai/kimi-k2.6',
    maxOutput: 262_144,
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
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Flash is a 284B MoE model with 1M-token context optimized for fast coding and agents.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    id: 'deepseek-ai/deepseek-v4-flash',
    maxOutput: 393_216,
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'DeepSeek V4 Pro scales to 1M-token context windows with efficient MoE architecture for coding tasks.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    id: 'deepseek-ai/deepseek-v4-pro',
    maxOutput: 393_216,
    settings: {
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      'GLM-5.1 is a flagship LLM for agentic workflows, coding, and long-horizon reasoning tasks.',
    displayName: 'GLM-5.1',
    enabled: true,
    id: 'z-ai/glm-5.1',
    maxOutput: 131_072,
    settings: {
      extendParams: ['enableReasoning'],
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
      'Nemotron 3 Nano Omni is an omni-modal reasoning model that understands images, video, speech, text.',
    displayName: 'Nemotron 3 Nano Omni',
    id: 'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Open, efficient hybrid Mamba-Transformer MoE with 1M context, excelling in agentic reasoning, coding, planning, tool calling, and more.',
    displayName: 'Nemotron 3 Super',
    id: 'nvidia/nemotron-3-super-120b-a12b',
    maxOutput: 262_144,
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
    contextWindowTokens: 262_144,
    description:
      'Qwen3.5 122B-A10B is a 122B MoE LLM (10B active) for coding, reasoning, multimodal chat.',
    displayName: 'Qwen3.5 122B A10B',
    id: 'qwen/qwen3.5-122b-a10b',
    maxOutput: 65_536,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Next-gen Qwen 3.5 VLM (400B MoE) brings advanced vision, chat, RAG, and agentic capabilities.',
    displayName: 'Qwen3.5 397B A17B',
    id: 'qwen/qwen3.5-397b-a17b',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 256_000,
    description:
      '200B open-source reasoning engine with sparse MoE powering frontier agentic AI.',
    displayName: 'Step 3.5 Flash',
    id: 'stepfun-ai/step-3.5-flash',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Open, efficient MoE model with 1M context, excelling in coding, reasoning, instruction following, tool calling, and more.',
    displayName: 'Nemotron 3 Nano',
    id: 'nvidia/nemotron-3-nano-30b-a3b',
    maxOutput: 131_072,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 256_000,
    description:
      'Dense 31B model delivering frontier reasoning for coding, agentic workflows, and fine-tuning.',
    displayName: 'Gemma 4 31B',
    enabled: true,
    id: 'google/gemma-4-31b-it',
    maxOutput: 16_384,
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'A state-of-the-art general purpose MoE VLM ideal for chat, agentic and instruction based use cases.',
    displayName: 'Mistral Large 3',
    id: 'mistralai/mistral-large-3-675b-instruct-2512',
    maxOutput: 262_144,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'A general purpose VLM ideal for chat and instruction based use cases.',
    displayName: 'Ministral 14B',
    id: 'mistralai/ministral-14b-instruct-2512',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Nemotron Nano 12B v2 VL enables multi-image and video understanding, along with visual Q&A and summarization capabilities.',
    displayName: 'Nemotron Nano 12B v2 VL',
    id: 'nvidia/nemotron-nano-12b-v2-vl',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      vision: false,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3-Next Instruct blends hybrid attention, sparse MoE, and stability boosts for ultra-long context AI.',
    displayName: 'Qwen3 Next 80B A3B Instruct',
    id: 'qwen/qwen3-next-80b-a3b-instruct',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      '80B parameter AI model with hybrid reasoning, MoE architecture, support for 119 languages.',
    displayName: 'Qwen3 Next 80B A3B Thinking',
    id: 'qwen/qwen3-next-80b-a3b-thinking',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_000,
    description:
      'ByteDance open-source LLM with long-context, reasoning, and agentic intelligence.',
    displayName: 'Seed OSS 36B Instruct',
    id: 'bytedance/seed-oss-36b-instruct',
    maxOutput: 262_000,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Excels in agentic coding and browser use and supports 256K context, delivering top results.',
    displayName: 'Qwen3 Coder 480B A35B',
    id: 'qwen/qwen3-coder-480b-a35b-instruct',
    maxOutput: 66_536,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'High-efficiency LLM with hybrid Transformer-Mamba design, excelling in reasoning and agentic tasks.',
    displayName: 'NVIDIA Nemotron Nano 9B v2',
    id: 'nvidia/nvidia-nemotron-nano-9b-v2',
    maxOutput: 131_072,
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
    contextWindowTokens: 131_072,
    description:
      'Smaller Mixture of Experts (MoE) text-only LLM for efficient AI reasoning and math.',
    displayName: 'GPT OSS 20B',
    id: 'openai/gpt-oss-20b',
    maxOutput: 131_072,
    settings: {
      extendParams: ['reasoningEffort'],
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
      'Mixture of Experts (MoE) reasoning LLM (text-only) designed to fit within 80GB GPU.',
    displayName: 'GPT OSS 120B',
    id: 'openai/gpt-oss-120b',
    maxOutput: 131_072,
    settings: {
      extendParams: ['reasoningEffort'],
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
      'High efficiency model with leading accuracy for reasoning, tool calling, chat, and instruction following.',
    displayName: 'Llama 3.3 Nemotron Super 49B v1.5',
    id: 'nvidia/llama-3.3-nemotron-super-49b-v1.5',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Multilingual, hybrid-reasoning model optimized for Indian language tasks, programming, mathematical reasoning capabilities.',
    displayName: 'Sarvam M',
    id: 'sarvamai/sarvam-m',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'Built for agentic workflows, this model excels in coding, instruction following, and function calling.',
    displayName: 'Mistral Nemotron',
    id: 'mistralai/mistral-nemotron',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: false,
    },
    contextWindowTokens: 131_072,
    description:
      'Powerful, multimodal language model designed for enterprise applications, including software development, data analysis, and reasoning.',
    displayName: 'Mistral Medium 3',
    id: 'mistralai/mistral-medium-3-instruct',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'A general purpose multimodal, multilingual 128 MoE model with 17B parameters.',
    displayName: 'Llama 4 Maverick 17B 128E',
    id: 'meta/llama-4-maverick-17b-128e-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'High efficiency model with leading accuracy for reasoning, tool calling, chat, and instruction following.',
    displayName: 'Llama 3.3 Nemotron Super 49B v1',
    id: 'nvidia/llama-3.3-nemotron-super-49b-v1',
    maxOutput: 131_072,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Lightweight multilingual LLM powering AI applications in latency bound, memory/compute constrained environments.',
    displayName: 'Phi 4 Mini Instruct',
    id: 'microsoft/phi-4-mini-instruct',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Cutting-edge open multimodal model exceling in high-quality reasoning from image and audio inputs.',
    displayName: 'Phi 4 Multimodal Instruct',
    id: 'microsoft/phi-4-multimodal-instruct',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'State-of-the-art LLM that answers OpenUSD knowledge queries and generates USD-Python code.',
    displayName: 'USD Code',
    id: 'nvidia/usdcode',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'Fine-tuned Llama 3.1 70B model for code generation, summarization, and multi-language tasks.',
    displayName: 'Dracarys Llama 3.1 70B',
    id: 'abacusai/dracarys-llama-3.1-70b-instruct',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'Optimized SLM for on-device inference and fine-tuned for roleplay, RAG and function calling.',
    displayName: 'Nemotron Mini 4B Instruct',
    id: 'nvidia/nemotron-mini-4b-instruct',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 65_536,
    description:
      'This LLM follows instructions, completes requests, and generates creative text.',
    displayName: 'Mistral 7B Instruct v0.3',
    id: 'mistralai/mistral-7b-instruct-v0.3',
    maxOutput: 65_536,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'An MOE LLM that follows instructions, completes requests, and generates creative text.',
    displayName: 'Mixtral 8x7B Instruct',
    id: 'mistralai/mixtral-8x7b-instruct-v0.1',
    maxOutput: 32_768,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Advanced LLM for reasoning, math, general knowledge, and function calling.',
    displayName: 'Llama 3.3 70B Instruct',
    id: 'meta/llama-3.3-70b-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'Advanced state-of-the-art small language model with language understanding, superior reasoning, and text generation.',
    displayName: 'Llama 3.2 1B Instruct',
    id: 'meta/llama-3.2-1b-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: false,
      reasoning: false,
    },
    contextWindowTokens: 32_768,
    description:
      'Advanced state-of-the-art small language model with language understanding, superior reasoning, and text generation.',
    displayName: 'Llama 3.2 3B Instruct',
    id: 'meta/llama-3.2-3b-instruct',
    maxOutput: 32_000,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Cutting-edge vision-language model exceling in high-quality reasoning from images.',
    displayName: 'Llama 3.2 11B Vision Instruct',
    id: 'meta/llama-3.2-11b-vision-instruct',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Cutting-edge vision-language model exceling in high-quality reasoning from images.',
    displayName: 'Llama 3.2 90B Vision Instruct',
    id: 'meta/llama-3.2-90b-vision-instruct',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 16_000,
    description:
      'Advanced state-of-the-art model with language understanding, superior reasoning, and text generation.',
    displayName: 'Llama 3.1 8B Instruct',
    id: 'meta/llama-3.1-8b-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'Powers complex conversations with superior contextual understanding, reasoning and text generation.',
    displayName: 'Llama 3.1 70B Instruct',
    id: 'meta/llama-3.1-70b-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'An advanced small language model designed for edge applications.',
    displayName: 'Gemma 2 2B',
    id: 'google/gemma-2-2b-it',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: false,
    },
    contextWindowTokens: 128_000,
    description:
      'An advanced LLM for code generation, reasoning, and fixing across popular programming languages.',
    displayName: 'Qwen2.5 Coder 32B',
    id: 'qwen/qwen2.5-coder-32b-instruct',
    maxOutput: 4_096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Hybrid MoE model unifying instruct, reasoning, and coding with multimodal input and 256k context.',
    displayName: 'Mistral Small 4',
    id: 'mistralai/mistral-small-4-119b-2603',
    maxOutput: 8_192,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    description:
      'Open VLM for quantum computer calibration chart understanding across a range of qubit modalities.',
    displayName: 'Ising Calibration 1 35B A3B',
    id: 'nvidia/ising-calibration-1-35b-a3b',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    description:
      'A high performing model for text generation, coding and agentic use cases.',
    displayName: 'Mistral Medium 3.5 128B',
    id: 'mistralai/mistral-medium-3.5-128b',
    type: 'chat',
  },
  {
    description:
      'Japanese-specialized large-language-model for enterprises to read and understand complex business documents.',
    displayName: 'Stockmark 2 100B Instruct',
    id: 'stockmark/stockmark-2-100b-instruct',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    description:
      'Multi-modal vision-language model that understands text/img and creates informative responses.',
    displayName: 'Llama 3.1 Nemotron Nano VL 8B v1',
    id: 'nvidia/llama-3.1-nemotron-nano-vl-8b-v1',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    description:
      'Leading reasoning and agentic AI accuracy model for PC and edge.',
    displayName: 'Llama 3.1 Nemotron Nano 8B v1',
    id: 'nvidia/llama-3.1-nemotron-nano-8b-v1',
    type: 'chat',
  },
];

export const allModels = [...nvidiaChatModels];

export default allModels;
