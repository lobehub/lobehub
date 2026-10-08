import type { AIChatModelCard } from '../types/aiModel';

// Y-API — https://y-api.bestvirtualgoods.com/pricing
// An OpenAI-compatible relay. Model ids keep the upstream organization prefix
// (`openai/gpt-5.6-sol`) exactly as `GET /v1/models` returns them, so they are
// listed verbatim rather than rewritten.
//
// Reasoning controls: this relay is narrower than the labs it fronts, so the
// cards reuse the shared param whose value set matches what Y-API accepts
// rather than the lab-named one. Measured against the live API 2026-09-17 by
// sending each level n=5 and reading the rejection:
//
//   openai/gpt-5.6-*    accepts none|low|medium|high|xhigh, rejects max (5/5 400)
//   openai/gpt-6-astra  accepts low|medium|high|xhigh, rejects none and max (5/5 400)
//   tencent/hy3         accepts low|high, rejects no_think (5/5 400; low and
//                       high each returned 5/5 200 as controls)
//
// The rejections are hard 400s, e.g.
//   "Unsupported value: 'reasoning_effort' does not support 'max' with this
//    model. Supported values are: 'none', 'low', 'medium', 'high', and 'xhigh'."
//
// so the lab-named `gpt5_6ReasoningEffort` / `gpt6ReasoningEffort` /
// `hy3ReasoningEffort` — which respectively include `max`, `max`, and
// `no_think` — would each let a user pick a level that fails every request.
// The first-party `hunyuan` provider keeps `hy3ReasoningEffort`; Hunyuan's own
// API does accept `no_think`, it is only this relay that does not.
const yapiChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Flash is the fast, cost-efficient member of the V4 family, with a 1M context window and hybrid thinking. Y-API serves it free of charge.',
    displayName: 'DeepSeek V4 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek/deepseek-v4-flash',
    maxOutput: 384_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'A dated DeepSeek V4 Flash snapshot (2026-07-31) kept for reproducibility, with a 1M context window and hybrid thinking.',
    displayName: 'DeepSeek V4 Flash (0731)',
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek/deepseek-v4-flash-0731',
    maxOutput: 384_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.0075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4 Pro is the flagship of the V4 family, built for high-intensity reasoning and agentic workflows with a 1M context window.',
    displayName: 'DeepSeek V4 Pro',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek/deepseek-v4-pro',
    maxOutput: 384_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'DeepSeek V4.1 Flash is a low-cost V4 refresh with a 1M context window and hybrid thinking, aimed at high-volume workloads.',
    displayName: 'DeepSeek V4.1 Flash',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4.1',
    id: 'deepseek/deepseek-v4.1-flash',
    maxOutput: 384_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.01, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['deepseekV4GAReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Kimi K3 is Kimi's most capable model, offering native visual understanding and a 1M-token context window for software engineering, knowledge work, and deep reasoning.",
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'moonshotai/kimi-k3',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['kimiK3ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Luna is the lowest-priced member of the GPT-5.6 family, optimized for cost-sensitive, high-volume workloads.',
    displayName: 'GPT-5.6 Luna',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'openai/gpt-5.6-luna',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.015, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.065, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Sol is the most capable model in the GPT-5.6 family, the top choice for coding and agentic work.',
    displayName: 'GPT-5.6 Sol',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'openai/gpt-5.6-sol',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      'GPT-5.6 Terra balances intelligence and cost for everyday professional work within the GPT-5.6 family.',
    displayName: 'GPT-5.6 Terra',
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'openai/gpt-5.6-terra',
    knowledgeCutoff: '2026-02',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_050_000,
    description:
      "OpenAI's most capable model for complex reasoning, coding, computer use, research, and document creation.",
    displayName: 'GPT-6 Astra',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-6',
    id: 'openai/gpt-6-astra',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['codexMaxReasoningEffort'],
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
      'Hunyuan Hy3 is optimized for production agent workloads, with improvements in coding agents, long-document understanding, and multi-step task execution. Y-API serves it free of charge.',
    displayName: 'Hy3',
    enabled: true,
    family: 'hunyuan',
    generation: 'hunyuan-3',
    id: 'tencent/hy3',
    maxOutput: 128_000,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['step3_5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'MiMo-V2.5 is a native omni-modal agent foundation model with a 1M context window, delivering agentic performance at a fraction of flagship cost. Y-API serves it free of charge.',
    displayName: 'MiMo-V2.5',
    enabled: true,
    family: 'mimo',
    id: 'xiaomi/mimo-v2.5',
    knowledgeCutoff: '2024-12',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
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
    contextWindowTokens: 1_000_000,
    description:
      'GLM-5.2 is Zhipu’s long-horizon model, with a 1M context window that can hold project-scale engineering context.',
    displayName: 'GLM-5.2',
    family: 'glm',
    generation: 'glm-5.2',
    id: 'z-ai/glm-5.2',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.22, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['glm5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'GLM-5.3 is Zhipu’s latest flagship, scaling post-training with far longer-horizon task environments and substantially improved coding experience over the previous generation.',
    displayName: 'GLM-5.3',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'z-ai/glm-5.3',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['glm5_3ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'GLM-5.3-Flash inherits the GLM-5.3 text contract with always-on thinking at roughly one-tenth of the flagship price.',
    displayName: 'GLM-5.3-Flash',
    enabled: true,
    family: 'glm',
    generation: 'glm-5.3',
    id: 'z-ai/glm-5.3-flash',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.0075, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    settings: {
      extendParams: ['glm5_3ReasoningEffort'],
    },
    type: 'chat',
  },
];

export const allModels = [...yapiChatModels];

export default allModels;
