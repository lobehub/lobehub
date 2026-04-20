import { type AIChatModelCard } from '../types/aiModel';

// https://help.aliyun.com/zh/model-studio/coding-plan-overview

const bailianCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3.5 Plus supports text, image, and video input. Its performance on pure text tasks is comparable to Qwen3 Max, with better performance and lower cost. Its multimodal capabilities are significantly improved compared to the Qwen3 VL series.',
    displayName: 'Qwen3.5 Plus',
    enabled: true,
    id: 'qwen3.5-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-02-15',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'Qwen3 Coder Plus: Strong coding-agent abilities, tool use, and environment interaction for autonomous programming.',
    displayName: 'Qwen3 Coder Plus',
    id: 'qwen3-coder-plus',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2025-09-23',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Max: Best-performing Qwen model for complex, multi-step coding tasks with thinking support.',
    displayName: 'Qwen3 Max',
    enabled: true,
    id: 'qwen3-max-2026-01-23',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-01-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Qwen3 Coder Next: Next-gen coder optimized for complex multi-file code generation, debugging, and agent workflows.',
    displayName: 'Qwen3 Coder Next',
    id: 'qwen3-coder-next',
    maxOutput: 65_536,
    organization: 'Qwen',
    releasedAt: '2026-02-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 200_000,
    description:
      "GLM-5 is Zhipu's next-generation flagship foundation model, purpose-built for Agentic Engineering. It delivers reliable productivity in complex systems engineering and long-horizon agentic tasks.",
    displayName: 'GLM-5',
    enabled: true,
    id: 'glm-5',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-02-12',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken32k'],
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
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration.",
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'glm-4.7',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2025-12-01',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken32k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.5 is Kimi's most versatile model to date, featuring a native multimodal architecture that supports both vision and text inputs, 'thinking' and 'non-thinking' modes, and both conversational and agent tasks.",
    displayName: 'Kimi K2.5',
    enabled: true,
    id: 'kimi-k2.5',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-01-27',
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
    contextWindowTokens: 204_800,
    description:
      'MiniMax-M2.5 is a flagship open-source large model from MiniMax, focusing on solving complex real-world tasks. Its core strengths are multi-language programming capabilities and the ability to solve complex tasks as an Agent.',
    displayName: 'MiniMax-M2.5',
    enabled: true,
    id: 'MiniMax-M2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    releasedAt: '2026-02-12',
    type: 'chat',
  },
];

export default bailianCodingPlanChatModels;
