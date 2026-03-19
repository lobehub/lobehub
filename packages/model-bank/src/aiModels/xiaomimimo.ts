import type { AIChatModelCard } from '../types/aiModel';

const xiaomimimoChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Xiaomi MiMo-V2-Pro is specifically designed for high-intensity agent workflows in real-world scenarios. It features over 1 trillion total parameters (42B activated parameters), adopts an innovative hybrid attention architecture, and supports an ultra-long context length of up to 1 million tokens. Built on a powerful foundational model, we continuously scale computational resources across a broader range of agent scenarios, further expanding the action space of intelligence and achieving significant generalization—from coding to real-world task execution (“claw”).',
    displayName: 'MiMo-V2 Pro',
    enabled: true,
    id: 'mimo-v2-pro',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        {
          name: 'textInput',
          strategy: 'tiered',
          tiers: [
            { rate: 7, upTo: 256_000 },
            { rate: 14, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textInput_cacheRead',
          strategy: 'tiered',
          tiers: [
            { rate: 1.4, upTo: 256_000 },
            { rate: 2.8, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
        {
          name: 'textOutput',
          strategy: 'tiered',
          tiers: [
            { rate: 21, upTo: 256_000 },
            { rate: 42, upTo: 'infinity' },
          ],
          unit: 'millionTokens',
        },
      ],
    },
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Omni is purpose-built for complex multimodal interaction and execution scenarios in the real world. We constructed a full-modality foundation from the ground up, integrating text, vision, and speech, and unified “perception” and “action” within a single architecture. This not only breaks the traditional limitation of models that emphasize understanding over execution, but also endows the model with native capabilities in multimodal perception, tool usage, function execution, and GUI operations. MiMo-V2-Omni can seamlessly integrate with major agent frameworks, achieving a leap from understanding to control while significantly lowering the barrier to deploying fully multimodal agents.',
    displayName: 'MiMo-V2 Omni',
    enabled: true,
    id: 'mimo-v2-omni',
    maxOutput: 131_072,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 2.8, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.56, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      search: true,
      structuredOutput: true,
    },
    contextWindowTokens: 262_144,
    description:
      'MiMo-V2-Flash is now officially open source! This is a MoE (Mixture-of-Experts) model purpose-built for extreme inference efficiency, with 309B total parameters (15B activated). Through innovations in a hybrid attention architecture and multi-layer MTP inference acceleration, it ranks among the global Top 2 open-source models across multiple agent benchmarking suites. Its coding capabilities surpass all open-source models and rival leading closed-source models such as Claude 4.5 Sonnet, while incurring only 2.5% of the inference cost and delivering 2× faster generation speed—pushing large-model inference efficiency to the limit.',
    displayName: 'MiMo-V2 Flash',
    enabled: true,
    id: 'mimo-v2-flash',
    maxOutput: 65_536,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput', rate: 0.7, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2.1, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-03',
    settings: {
      extendParams: ['enableReasoning'],
      searchImpl: 'params',
    },
    type: 'chat',
  },
];

export const allModels = [...xiaomimimoChatModels];

export default allModels;
