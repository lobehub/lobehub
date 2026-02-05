import type { AIChatModelCard } from '../types/aiModel';

const togetheraiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Meta Llama 3.3 multilingual LLM is a 70B (text-in/text-out) pretrained and instruction-tuned model. The instruction-tuned text-only version is optimized for multilingual chat and outperforms many open and closed chat models on common industry benchmarks.',
    displayName: 'Llama 3.3 70B Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 3B Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Llama-3.2-3B-Instruct-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 11B Vision Instruct Turbo (Free)',
    enabled: true,
    id: 'meta-llama/Llama-Vision-Free',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 11B Vision Instruct Turbo',
    id: 'meta-llama/Llama-3.2-11B-Vision-Instruct-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      vision: true,
    },
    contextWindowTokens: 131_072,
    description:
      'LLaMA 3.2 is designed for tasks combining vision and text. It excels at image captioning and visual QA, bridging language generation and visual reasoning.',
    displayName: 'Llama 3.2 90B Vision Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 8B uses FP8 quantization, supports up to 131,072 context tokens, and ranks among top open models for complex tasks across many benchmarks.',
    displayName: 'Llama 3.1 8B Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 131_072,
    description:
      'Llama 3.1 70B is finely tuned for high-load applications; FP8 quantization delivers efficient compute and accuracy for complex scenarios.',
    displayName: 'Llama 3.1 70B Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 130_815,
    description:
      'The 405B Llama 3.1 Turbo model provides massive context capacity for big data processing and excels in ultra-scale AI applications.',
    displayName: 'Llama 3.1 405B Instruct Turbo',
    enabled: true,
    id: 'meta-llama/Meta-Llama-3.1-405B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Llama 3.1 Nemotron 70B is an NVIDIA-customized LLM to improve helpfulness. It performs strongly on Arena Hard, AlpacaEval 2 LC, and GPT-4-Turbo MT-Bench, ranking #1 on all three auto-alignment benchmarks as of Oct 1, 2024. It is trained from Llama-3.1-70B-Instruct using RLHF (REINFORCE), Llama-3.1-Nemotron-70B-Reward, and HelpSteer2-Preference prompts.',
    displayName: 'Llama 3.1 Nemotron 70B',
    enabled: true,
    id: 'nvidia/Llama-3.1-Nemotron-70B-Instruct-HF',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 8B Instruct Turbo is a high-performance LLM for a wide range of use cases.',
    displayName: 'Llama 3 8B Instruct Turbo',
    id: 'meta-llama/Meta-Llama-3-8B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 70B Instruct Turbo delivers strong understanding and generation for the most demanding workloads.',
    displayName: 'Llama 3 70B Instruct Turbo',
    id: 'meta-llama/Meta-Llama-3-70B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 8B Instruct Lite balances performance for resource-constrained environments.',
    displayName: 'Llama 3 8B Instruct Lite',
    id: 'meta-llama/Meta-Llama-3-8B-Instruct-Lite',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Llama 3 70B Instruct Lite is built for high performance with lower latency.',
    displayName: 'Llama 3 70B Instruct Lite',
    id: 'meta-llama/Meta-Llama-3-70B-Instruct-Lite',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Llama 3 8B Instruct Reference offers multilingual support and broad domain knowledge.',
    displayName: 'Llama 3 8B Instruct Reference',
    id: 'meta-llama/Llama-3-8b-chat-hf',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description: 'Llama 3 70B Instruct Reference is a powerful chat model for complex dialogues.',
    displayName: 'Llama 3 70B Instruct Reference',
    id: 'meta-llama/Llama-3-70b-chat-hf',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'LLaMA-2 Chat (13B) provides strong language handling and a solid chat experience.',
    displayName: 'LLaMA-2 Chat (13B)',
    id: 'meta-llama/Llama-2-13b-chat-hf',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'LLaMA-2 provides strong language handling and a solid interaction experience.',
    displayName: 'LLaMA-2 (70B)',
    id: 'meta-llama/Llama-2-70b-hf',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'Code Llama is an LLM focused on code generation and discussion, with broad language support for developer workflows.',
    displayName: 'CodeLlama 34B Instruct',
    id: 'codellama/CodeLlama-34b-Instruct-hf',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 9B, developed by Google, offers efficient instruction following and solid overall capability.',
    displayName: 'Gemma 2 9B',
    enabled: true,
    id: 'google/gemma-2-9b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma 2 27B is a general-purpose LLM with strong performance across many scenarios.',
    displayName: 'Gemma 2 27B',
    enabled: true,
    id: 'google/gemma-2-27b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Gemma Instruct (2B) provides basic instruction handling for lightweight applications.',
    displayName: 'Gemma Instruct (2B)',
    id: 'google/gemma-2b-it',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mistral (7B) Instruct v0.3 offers efficient compute and strong language understanding for many use cases.',
    displayName: 'Mistral (7B) Instruct v0.3',
    enabled: true,
    id: 'mistralai/Mistral-7B-Instruct-v0.3',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Mistral (7B) Instruct v0.2 improves instruction handling and result accuracy.',
    displayName: 'Mistral (7B) Instruct v0.2',
    id: 'mistralai/Mistral-7B-Instruct-v0.2',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 8192,
    description: 'Mistral (7B) Instruct is known for strong performance across language tasks.',
    displayName: 'Mistral (7B) Instruct',
    id: 'mistralai/Mistral-7B-Instruct-v0.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 8192,
    description:
      'Mistral 7B is compact but high-performing, strong for batch processing and simple tasks like classification and text generation, with solid reasoning.',
    displayName: 'Mistral (7B)',
    id: 'mistralai/Mistral-7B-v0.1',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 32_768,
    description:
      'Mixtral-8x7B Instruct (46.7B) provides high capacity suited for large-scale data processing.',
    displayName: 'Mixtral-8x7B Instruct (46.7B)',
    enabled: true,
    id: 'mistralai/Mixtral-8x7B-Instruct-v0.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Mixtral 8x7B is a sparse MoE model that boosts inference speed, suitable for multilingual and code generation tasks.',
    displayName: 'Mixtral-8x7B (46.7B)',
    id: 'mistralai/Mixtral-8x7B-v0.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description: 'Mixtral-8x22B Instruct (141B) is a very large LLM for heavy workloads.',
    displayName: 'Mixtral-8x22B Instruct (141B)',
    enabled: true,
    id: 'mistralai/Mixtral-8x22B-Instruct-v0.1',
    type: 'chat',
  },
  {
    contextWindowTokens: 65_536,
    description:
      'WizardLM 2 is a language model from Microsoft AI that excels at complex dialogue, multilingual tasks, reasoning, and assistants.',
    displayName: 'WizardLM-2 8x22B',
    id: 'microsoft/WizardLM-2-8x22B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description:
      'DeepSeek-R1 improves reasoning with RL and cold-start data, setting new open-model multi-task benchmarks and surpassing OpenAI-o1-mini.',
    displayName: 'DeepSeek-R1',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-R1',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1 distilled models use RL and cold-start data to improve reasoning and set new open-model multi-task benchmarks.',
    displayName: 'DeepSeek R1 Distill Qwen 1.5B',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1 distilled models use RL and cold-start data to improve reasoning and set new open-model multi-task benchmarks.',
    displayName: 'DeepSeek R1 Distill Qwen 14B',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-14B',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 131_072,
    description:
      'DeepSeek-R1 distilled models use RL and cold-start data to improve reasoning and set new open-model multi-task benchmarks.',
    displayName: 'DeepSeek R1 Distill Llama 70B',
    id: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
    type: 'chat',
  },
  {
    contextWindowTokens: 16_384,
    description:
      'The latest DeepSeek-V3 surpasses open models like Qwen2.5-72B and Llama-3.1-405B on many benchmarks, aligning with leading closed models GPT-4o and Claude-3.5-Sonnet.',
    displayName: 'DeepSeek-V3',
    enabled: true,
    id: 'deepseek-ai/DeepSeek-V3',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'DeepSeek LLM Chat (67B) is an innovative model offering deep language understanding and interaction.',
    displayName: 'DeepSeek LLM Chat (67B)',
    id: 'deepseek-ai/deepseek-llm-67b-chat',
    type: 'chat',
  },
  {
    abilities: {
      reasoning: true,
    },
    contextWindowTokens: 32_768,
    description: 'QwQ is an experimental research model from Qwen focused on enhanced reasoning.',
    displayName: 'QwQ 32B Preview',
    enabled: true,
    id: 'Qwen/QwQ-32B-Preview',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen2.5 is a new LLM family optimized for instruction-style tasks.',
    displayName: 'Qwen 2.5 7B Instruct Turbo',
    enabled: true,
    id: 'Qwen/Qwen2.5-7B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'Qwen2.5 is a new LLM family optimized for instruction-style tasks.',
    displayName: 'Qwen 2.5 72B Instruct Turbo',
    enabled: true,
    id: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen2.5 Coder 32B Instruct is the latest Alibaba Cloud code-focused LLM. Built on Qwen2.5 and trained on 5.5T tokens, it significantly improves code generation, reasoning, and repair while retaining math and general strengths, providing a strong base for coding agents.',
    displayName: 'Qwen 2.5 Coder 32B Instruct',
    id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Qwen 2 Instruct (72B) delivers precise instruction following for enterprise workloads.',
    displayName: 'Qwen 2 Instruct (72B)',
    id: 'Qwen/Qwen2-72B-Instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description: 'DBRX Instruct offers highly reliable instruction handling across industries.',
    displayName: 'DBRX Instruct',
    id: 'databricks/dbrx-instruct',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description:
      'Upstage SOLAR Instruct v1 (11B) is tuned for precise instruction tasks with strong language performance.',
    displayName: 'Upstage SOLAR Instruct v1 (11B)',
    id: 'upstage/SOLAR-10.7B-Instruct-v1.0',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'Nous Hermes 2 - Mixtral 8x7B-DPO (46.7B) is a high-precision instruction model for complex computation.',
    displayName: 'Nous Hermes 2 - Mixtral 8x7B-DPO (46.7B)',
    id: 'NousResearch/Nous-Hermes-2-Mixtral-8x7B-DPO',
    type: 'chat',
  },
  {
    contextWindowTokens: 4096,
    description: 'MythoMax-L2 (13B) is an innovative model for diverse domains and complex tasks.',
    displayName: 'MythoMax-L2 (13B)',
    id: 'Gryphe/MythoMax-L2-13b',
    type: 'chat',
  },
  {
    contextWindowTokens: 32_768,
    description:
      'StripedHyena Nous (7B) delivers enhanced compute efficiency through its architecture and strategy.',
    displayName: 'StripedHyena Nous (7B)',
    id: 'togethercomputer/StripedHyena-Nous-7B',
    type: 'chat',
  },
];

export const allModels = [...togetheraiChatModels];

export default allModels;
