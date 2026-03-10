import type { AIChatModelCard } from '../types/aiModel';

const githubChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o3 is a powerful general-purpose model that excels across domains. It sets a new bar for math, science, coding, and vision reasoning, and also shines at technical writing and instruction following. It can analyze text, code, and images to solve complex multi-step problems.',
    displayName: 'o3',
    id: 'openai/o3',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 40, strategy: 'fixed', unit: 'millionTokens' },
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
      'o4-mini is our latest small o-series model, optimized for fast, efficient reasoning with strong performance on coding and vision tasks.',
    displayName: 'o4-mini',
    enabled: true,
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
    description:
      'GPT-4.1 is our flagship model for complex tasks, ideal for cross-domain problem solving.',
    displayName: 'GPT-4.1',
    enabled: true,
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
      'GPT-4.1 mini balances intelligence, speed, and cost, making it attractive for many use cases.',
    displayName: 'GPT-4.1 mini',
    enabled: true,
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
    description: 'GPT-4.1 nano is the fastest and most cost-effective GPT-4.1 model.',
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
    description:
      'o3-mini is our newest small reasoning model, delivering high intelligence at the same cost and latency targets as o1-mini.',
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
      'o1-mini is a fast, cost-effective reasoning model designed for coding, math, and science use cases. It has 128K context and an October 2023 knowledge cutoff.',
    displayName: 'o1-mini',
    id: 'openai/o1-mini',
    maxOutput: 65_536,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 0.55, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-09-12',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 200_000,
    description:
      'o1 is OpenAI’s new reasoning model that supports image and text inputs with text outputs, suitable for complex tasks needing broad knowledge. It has 200K context and an October 2023 knowledge cutoff.',
    displayName: 'o1',
    id: 'openai/o1',
    maxOutput: 100_000,
    pricing: {
      units: [
        { name: 'textInput_cacheRead', rate: 7.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 60, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2024-12-17',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'o1 is OpenAI’s new reasoning model for complex tasks requiring broad knowledge. It has 128K context and an October 2023 knowledge cutoff.',
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
    contextWindowTokens: 134_144,
    description: 'A cost-effective AI solution for a wide range of text and image tasks.',
    displayName: 'GPT-4o mini',
    id: 'openai/gpt-4o-mini',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 134_144,
    description:
      'The most advanced multimodal model in the GPT-4 family, handling text and image inputs.',
    displayName: 'GPT-4o',
    id: 'openai/gpt-4o',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 134_144,
    displayName: 'Grok 3',
    id: 'xai/grok-3',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 134_144,
    displayName: 'Grok 3 mini',
    id: 'xai/grok-3-mini',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'MAI DS R1',
    id: 'microsoft/MAI-DS-R1',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek R1',
    id: 'deepseek/DeepSeek-R1',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    displayName: 'DeepSeek V3',
    id: 'deepseek/DeepSeek-V3-0324',
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
    id: 'ai21-labs/AI21-Jamba-1.5-Mini',
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
    id: 'ai21-labs/AI21-Jamba-1.5-Large',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Command R is a scalable generative model designed for RAG and tool use, enabling production-grade AI.',
    displayName: 'Cohere Command R',
    id: 'cohere/Cohere-command-r',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'Command R+ is an advanced RAG-optimized model built for enterprise workloads.',
    displayName: 'Cohere Command R+',
    id: 'cohere/Cohere-command-r-plus',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral Nemo is a cutting-edge LLM with state-of-the-art reasoning, world knowledge, and coding for its size.',
    displayName: 'Mistral Nemo',
    id: 'mistral-ai/Mistral-Nemo',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral Small is suitable for any language-based task requiring high efficiency and low latency.',
    displayName: 'Mistral Small',
    id: 'mistral-ai/mistral-small-2503',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Mistral’s flagship model for complex tasks needing large-scale reasoning or specialization (synthetic text generation, code generation, RAG, or agents).',
    displayName: 'Mistral Large',
    id: 'mistral-ai/Mistral-Large-2411',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 262_144,
    displayName: 'Codestral',
    id: 'mistral-ai/Codestral-2501',
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
    id: 'meta/Llama-3.2-11B-Vision-Instruct',
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
    id: 'meta/Llama-3.2-90B-Vision-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Llama 3.3 is the most advanced multilingual open-source Llama model, delivering near-405B performance at very low cost. It is Transformer-based and improved with SFT and RLHF for usefulness and safety. The instruction-tuned version is optimized for multilingual chat and beats many open and closed chat models on industry benchmarks. Knowledge cutoff: Dec 2023.',
    displayName: 'Llama 3.3 70B Instruct',
    enabled: true,
    id: 'meta/Llama-3.3-70B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 10_240_000,
    displayName: 'Meta Llama 4 Scout 17B',
    id: 'llama-4-Scout-17B-16E-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 10_240_000,
    displayName: 'Meta Llama 4 Maverick 17B',
    id: 'meta/Llama-4-Maverick-17B-128E-Instruct-FP8',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 8B',
    id: 'meta/Meta-Llama-3.1-8B-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 70B',
    id: 'meta/Meta-Llama-3.1-70B-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 instruction-tuned text model optimized for multilingual chat, performing strongly on common industry benchmarks among open and closed chat models.',
    displayName: 'Meta Llama 3.1 405B',
    id: 'meta/Meta-Llama-3.1-405B-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'A versatile 8B-parameter model optimized for chat and text generation.',
    displayName: 'Meta Llama 3 8B',
    id: 'meta/Meta-Llama-3-8B-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A powerful 70B-parameter model that excels at reasoning, coding, and broad language tasks.',
    displayName: 'Meta Llama 3 70B',
    id: 'meta/Meta-Llama-3-70B-Instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    displayName: 'Phi 4',
    id: 'microsoft/Phi-4',
    maxOutput: 16_384,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    displayName: 'Phi 3.5 MoE',
    id: 'microsoft/Phi-3.5-MoE-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description: 'An updated version of the Phi-3-mini model.',
    displayName: 'Phi-3.5-mini 128K',
    id: 'microsoft/Phi-3.5-mini-instruct',
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
    id: 'microsoft/Phi-3.5-vision-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'The smallest Phi-3 family member, optimized for quality and low latency.',
    displayName: 'Phi-3-mini 4K',
    id: 'microsoft/Phi-3-mini-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-mini model with a larger context window for RAG or few-shot prompts.',
    displayName: 'Phi-3-mini 128K',
    id: 'microsoft/Phi-3-mini-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'A 7B-parameter model with higher quality than Phi-3-mini, focused on high-quality, reasoning-intensive data.',
    displayName: 'Phi-3-small 8K',
    id: 'microsoft/Phi-3-small-8k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-small model with a larger context window for RAG or few-shot prompts.',
    displayName: 'Phi-3-small 128K',
    id: 'microsoft/Phi-3-small-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'A 14B-parameter model with higher quality than Phi-3-mini, focused on high-quality, reasoning-intensive data.',
    displayName: 'Phi-3-medium 4K',
    id: 'microsoft/Phi-3-medium-4k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'The same Phi-3-medium model with a larger context window for RAG or few-shot prompts.',
    displayName: 'Phi-3-medium 128K',
    id: 'microsoft/Phi-3-medium-128k-instruct',
    maxOutput: 4096,
    type: 'chat',
  },
];

export const allModels = [...githubChatModels];

export default allModels;
