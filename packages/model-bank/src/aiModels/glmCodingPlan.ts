import { type AIChatModelCard } from '../types/aiModel';

// ref: https://docs.z.ai/devpack/overview

const glmCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 204_800,
    description:
      "GLM-5.1 is Zhipu's latest flagship model, an enhanced iteration of GLM-5 with improved agentic engineering capabilities for complex systems engineering and long-horizon tasks.",
    displayName: 'GLM-5.1',
    enabled: true,
    id: 'GLM-5.1',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-03-27',
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
    contextWindowTokens: 200_000,
    description:
      "GLM-5 is Zhipu's next-generation flagship foundation model, purpose-built for Agentic Engineering. It delivers reliable productivity in complex systems engineering and long-horizon agentic tasks. In coding and agent capabilities, GLM-5 achieves state-of-the-art performance among open-source models.",
    displayName: 'GLM-5',
    enabled: true,
    id: 'GLM-5',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-02-12',
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
    contextWindowTokens: 200_000,
    description: 'GLM-5-Turbo: Optimized version of GLM-5 with faster inference for coding tasks.',
    displayName: 'GLM-5-Turbo',
    enabled: true,
    id: 'GLM-5-Turbo',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2026-02-12',
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
    contextWindowTokens: 200_000,
    description:
      "GLM-4.7 is Zhipu's latest flagship model, enhanced for Agentic Coding scenarios with improved coding capabilities, long-term task planning, and tool collaboration.",
    displayName: 'GLM-4.7',
    enabled: true,
    id: 'GLM-4.7',
    maxOutput: 131_072,
    organization: 'Zhipu',
    releasedAt: '2025-12-01',
    settings: {
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.6: Previous generation model.',
    displayName: 'GLM-4.6',
    id: 'GLM-4.6',
    maxOutput: 65_536,
    organization: 'Zhipu',
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.5: High-performance model for reasoning, coding, and agent tasks.',
    displayName: 'GLM-4.5',
    id: 'GLM-4.5',
    maxOutput: 65_536,
    organization: 'Zhipu',
    releasedAt: '2025-12-01',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 202_752,
    description: 'GLM-4.5-Air: Lightweight version for fast responses.',
    displayName: 'GLM-4.5-Air',
    id: 'GLM-4.5-Air',
    maxOutput: 65_536,
    organization: 'Zhipu',
    releasedAt: '2025-12-01',
    type: 'chat',
  },
];

export default glmCodingPlanChatModels;
