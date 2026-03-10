import type { AIChatModelCard } from '../types/aiModel';

const ollamaChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 163_840,
    description:
      'DeepSeek V3.1: a next-generation reasoning model with stronger complex reasoning and chain-of-thought, suited for deep analysis tasks.',
    displayName: 'DeepSeek V3.1',
    id: 'deepseek-v3.1:671b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GPT-OSS 20B is OpenAI’s open-source LLM with MXFP4 quantization, suitable for high-end consumer GPUs or Apple Silicon Macs. It excels at chat generation, coding, and reasoning, with function calling and tool use.',
    displayName: 'GPT-OSS 20B',
    id: 'gpt-oss:20b',
    releasedAt: '2025-08-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'GPT-OSS 120B is OpenAI’s flagship open-source model with MXFP4 quantization. It requires multi-GPU or high-end workstations and excels at complex reasoning, code generation, and multilingual processing, with advanced function calling and tool integration.',
    displayName: 'GPT-OSS 120B',
    id: 'gpt-oss:120b',
    releasedAt: '2025-08-05',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description: 'A high-performance long-context model from Alibaba for agents and coding tasks.',
    displayName: 'Qwen3 Coder 480B',
    id: 'qwen3-coder:480b',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-R1 is a reinforcement-learning-driven reasoning model that addresses repetition and readability issues. Before RL, it uses cold-start data to improve reasoning. It matches OpenAI-o1 on math, coding, and reasoning tasks, with carefully designed training improving overall results.',
    displayName: 'DeepSeek R1',
    id: 'deepseek-r1',
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description:
      'DeepSeek-V3 is a powerful MoE model with 671B total parameters and 37B active per token. It uses MLA and DeepSeekMoE architectures for efficient inference and training, with significant gains over the previous DeepSeek-V3.',
    displayName: 'DeepSeek V3 671B',
    id: 'deepseek-v3',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 8B',
    id: 'llama3.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 70B',
    id: 'llama3.1:70b',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Llama 3.1 is Meta’s leading model, scaling up to 405B parameters for complex dialogue, multilingual translation, and data analysis.',
    displayName: 'Llama 3.1 405B',
    id: 'llama3.1:405b',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Code Llama is an LLM focused on code generation and discussion, with broad language support for developer workflows.',
    displayName: 'Code Llama 7B',
    id: 'codellama',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Code Llama is an LLM focused on code generation and discussion, with broad language support for developer workflows.',
    displayName: 'Code Llama 13B',
    id: 'codellama:13b',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Code Llama is an LLM focused on code generation and discussion, with broad language support for developer workflows.',
    displayName: 'Code Llama 34B',
    id: 'codellama:34b',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Code Llama is an LLM focused on code generation and discussion, with broad language support for developer workflows.',
    displayName: 'Code Llama 70B',
    id: 'codellama:70b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 128_000,
    description:
      'QwQ is a reasoning model in the Qwen family. Compared with standard instruction-tuned models, it brings thinking and reasoning abilities that significantly improve downstream performance, especially on hard problems. QwQ-32B is a mid-sized reasoning model that competes well with top reasoning models like DeepSeek-R1 and o1-mini.',
    displayName: 'QwQ 32B',
    id: 'qwq',
    releasedAt: '2024-11-28',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Qwen3 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen3 7B',
    id: 'qwen3',
    type: 'chat',
  },

  {
    contextWindowTokens: 128_000,
    description:
      'Qwen2.5 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2.5 0.5B',
    id: 'qwen2.5:0.5b',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Qwen2.5 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2.5 1.5B',
    id: 'qwen2.5:1.5b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Qwen2.5 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2.5 7B',
    id: 'qwen2.5',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Qwen2.5 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2.5 72B',
    id: 'qwen2.5:72b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'CodeQwen1.5 is a large language model trained on extensive code data, built for complex programming tasks.',
    displayName: 'CodeQwen1.5 7B',
    id: 'codeqwen',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Qwen2 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2 0.5B',
    id: 'qwen2:0.5b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Qwen2 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2 1.5B',
    id: 'qwen2:1.5b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Qwen2 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2 7B',
    id: 'qwen2',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description:
      'Qwen2 is Alibaba’s next-generation large language model with strong performance across diverse use cases.',
    displayName: 'Qwen2 72B',
    id: 'qwen2:72b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 is Google’s efficient model, covering use cases from small apps to complex data processing.',
    displayName: 'Gemma 2 2B',
    id: 'gemma2:2b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 is Google’s efficient model, covering use cases from small apps to complex data processing.',
    displayName: 'Gemma 2 9B',
    id: 'gemma2',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 is Google’s efficient model, covering use cases from small apps to complex data processing.',
    displayName: 'Gemma 2 27B',
    id: 'gemma2:27b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'CodeGemma is a lightweight model for varied programming tasks, enabling fast iteration and integration.',
    displayName: 'CodeGemma 2B',
    id: 'codegemma:2b',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'CodeGemma is a lightweight model for varied programming tasks, enabling fast iteration and integration.',
    displayName: 'CodeGemma 7B',
    id: 'codegemma',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Phi-3 is Microsoft’s lightweight open model for efficient integration and large-scale reasoning.',
    displayName: 'Phi-3 3.8B',
    id: 'phi3',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Phi-3 is Microsoft’s lightweight open model for efficient integration and large-scale reasoning.',
    displayName: 'Phi-3 14B',
    id: 'phi3:14b',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'WizardLM 2 is a language model from Microsoft AI that excels at complex dialogue, multilingual tasks, reasoning, and assistants.',
    displayName: 'WizardLM 2 7B',
    id: 'wizardlm2',
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description:
      'WizardLM 2 is a language model from Microsoft AI that excels at complex dialogue, multilingual tasks, reasoning, and assistants.',
    displayName: 'WizardLM 2 8x22B',
    id: 'wizardlm2:8x22b',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'MathΣtral is built for scientific research and mathematical reasoning, with strong computation and explanation.',
    displayName: 'MathΣtral 7B',
    id: 'mathstral',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description: 'Mistral is Mistral AI’s 7B model, suitable for varied language tasks.',
    displayName: 'Mistral 7B',
    id: 'mistral',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Mixtral is Mistral AI’s MoE model with open weights, supporting code generation and language understanding.',
    displayName: 'Mixtral 8x7B',
    id: 'mixtral',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 65_536,
    description:
      'Mixtral is Mistral AI’s MoE model with open weights, supporting code generation and language understanding.',
    displayName: 'Mixtral 8x22B',
    id: 'mixtral:8x22b',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'Mixtral Large is Mistral’s flagship model, combining code generation, math, and reasoning with a 128K context window.',
    displayName: 'Mixtral Large 123B',
    id: 'mistral-large',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 128_000,
    description: 'Mistral Nemo is a high-efficiency 12B model from Mistral AI and NVIDIA.',
    displayName: 'Mixtral Nemo 12B',
    id: 'mistral-nemo',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Codestral is Mistral AI’s first code model, delivering strong code generation support.',
    displayName: 'Codestral 22B',
    id: 'codestral',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Aya 23 is Cohere’s multilingual model supporting 23 languages for diverse use cases.',
    displayName: 'Aya 23 8B',
    id: 'aya',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Aya 23 is Cohere’s multilingual model supporting 23 languages for diverse use cases.',
    displayName: 'Aya 23 35B',
    id: 'aya:35b',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Command R is an LLM optimized for chat and long-context tasks, ideal for dynamic interaction and knowledge management.',
    displayName: 'Command R 35B',
    id: 'command-r',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Command R+ is a high-performance LLM designed for real enterprise scenarios and complex apps.',
    displayName: 'Command R+ 104B',
    id: 'command-r-plus',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'DeepSeek V2 is an efficient MoE model for cost-effective processing.',
    displayName: 'DeepSeek V2 16B',
    id: 'deepseek-v2',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description: 'DeepSeek V2 236B is DeepSeek’s code-focused model with strong code generation.',
    displayName: 'DeepSeek V2 236B',
    id: 'deepseek-v2:236b',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'DeepSeek Coder V2 is an open-source MoE code model that performs strongly on coding tasks, comparable to GPT-4 Turbo.',
    displayName: 'DeepSeek Coder V2 16B',
    id: 'deepseek-coder-v2',
    type: 'chat',
  },
  {
    contextWindowTokens: 128_000,
    description:
      'DeepSeek Coder V2 is an open-source MoE code model that performs strongly on coding tasks, comparable to GPT-4 Turbo.',
    displayName: 'DeepSeek Coder V2 236B',
    id: 'deepseek-coder-v2:236b',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'LLaVA is a multimodal model combining a vision encoder and Vicuna for strong vision-language understanding.',
    displayName: 'LLaVA 7B',
    id: 'llava',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'LLaVA is a multimodal model combining a vision encoder and Vicuna for strong vision-language understanding.',
    displayName: 'LLaVA 13B',
    id: 'llava:13b',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 4096,
    description:
      'LLaVA is a multimodal model combining a vision encoder and Vicuna for strong vision-language understanding.',
    displayName: 'LLaVA 34B',
    id: 'llava:34b',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'MiniCPM-V is OpenBMB’s next-generation multimodal model with excellent OCR and multimodal understanding for wide-ranging use cases.',
    displayName: 'MiniCPM-V 8B',
    id: 'minicpm-v',
    type: 'chat',
  },
];

export const allModels = [...ollamaChatModels];

export default allModels;
