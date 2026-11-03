import type { AIChatModelCard } from '../types/aiModel';

const githubCopilotChatModels: AIChatModelCard[] = [
  // OpenAI Models
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.4 is the frontier model for complex professional work with highest reasoning capability.',
    displayName: 'GPT-5.4',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    knowledgeCutoff: '2025-08',
    releasedAt: '2026-03-05',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      "GPT-5.4 mini is OpenAI's strongest mini model for coding, computer use, and subagents.",
    displayName: 'GPT-5.4 mini',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-mini',
    knowledgeCutoff: '2025-08',
    releasedAt: '2026-03-18',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.3-Codex is the most capable agentic coding model to date, optimized for agentic coding tasks in Codex or similar environments.',
    displayName: 'GPT-5.3 Codex',
    family: 'gpt',
    generation: 'gpt-5.3',
    id: 'gpt-5.3-codex',
    knowledgeCutoff: '2025-08',
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['codexMaxReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 192_000,
    description:
      'GPT-5.2 is a flagship model for coding and agentic workflows with stronger reasoning and long-context performance.',
    displayName: 'GPT-5.2',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2',
    knowledgeCutoff: '2025-08',
    releasedAt: '2025-12-11',
    settings: {
      extendParams: ['gpt5_2ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 400_000,
    description:
      'GPT-5.2-Codex is an upgraded GPT-5.2 variant optimized for long-horizon, agentic coding tasks.',
    displayName: 'GPT-5.2 Codex',
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2-codex',
    knowledgeCutoff: '2025-08',
    releasedAt: '2025-12-18',
    settings: {
      extendParams: ['codexMaxReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 192_000,
    description:
      'GPT-5.1 — a flagship model optimized for coding and agent tasks with configurable reasoning effort and longer context.',
    displayName: 'GPT-5.1',
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1',
    knowledgeCutoff: '2024-09',
    releasedAt: '2025-11-13',
    settings: {
      extendParams: ['gpt5_1ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 192_000,
    description:
      'A faster, more cost-efficient GPT-5 variant for well-defined tasks, delivering quicker responses while maintaining quality.',
    displayName: 'GPT-5 mini',
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-mini',
    knowledgeCutoff: '2024-05',
    releasedAt: '2025-08-07',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 128_000,
    description:
      'GPT-4.1 is our flagship model for complex tasks and cross-domain problem solving.',
    displayName: 'GPT-4.1',
    family: 'gpt',
    generation: 'gpt-4.1',
    id: 'gpt-4.1',
    knowledgeCutoff: '2024-06',
    releasedAt: '2025-04-14',
    type: 'chat',
  },

  // Anthropic Models
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description:
      'Claude Opus 4.6 is Anthropic’s most intelligent model for building agents and coding.',
    displayName: 'Claude Opus 4.6',
    enabled: true,
    family: 'claude-opus',
    generation: 'claude-4.6',
    id: 'claude-opus-4.6',
    knowledgeCutoff: '2025-05',
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['enableAdaptiveThinking', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description:
      'Claude Opus 4.6 is Anthropic’s most intelligent model for building agents and coding.',
    displayName: 'Claude Opus 4.6 (Fast Mode)',
    family: 'claude-opus',
    generation: 'claude-4.6',
    id: 'claude-opus-4.6-fast',
    knowledgeCutoff: '2025-05',
    releasedAt: '2026-02-05',
    settings: {
      extendParams: ['enableAdaptiveThinking', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description: 'Claude Sonnet 4.6 is Anthropic’s best combination of speed and intelligence.',
    displayName: 'Claude Sonnet 4.6',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-4.6',
    id: 'claude-sonnet-4.6',
    knowledgeCutoff: '2025-05',
    releasedAt: '2026-02-17',
    settings: {
      extendParams: ['enableAdaptiveThinking', 'enableReasoning', 'reasoningBudgetToken', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description:
      'Claude Opus 4.5 is Anthropic’s flagship model, combining top-tier intelligence with scalable performance for complex, high-quality reasoning tasks.',
    displayName: 'Claude Opus 4.5',
    family: 'claude-opus',
    generation: 'claude-4.5',
    id: 'claude-opus-4.5',
    knowledgeCutoff: '2025-05',
    releasedAt: '2025-11-24',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description: 'Claude Sonnet 4.5 is Anthropic’s most intelligent model to date.',
    displayName: 'Claude Sonnet 4.5',
    family: 'claude-sonnet',
    generation: 'claude-4.5',
    id: 'claude-sonnet-4.5',
    knowledgeCutoff: '2025-01',
    releasedAt: '2025-09-29',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 139_000,
    description:
      'Claude Haiku 4.5 is Anthropic’s fastest and smartest Haiku model, with lightning speed and extended reasoning.',
    displayName: 'Claude Haiku 4.5',
    enabled: true,
    family: 'claude-haiku',
    generation: 'claude-4.5',
    id: 'claude-haiku-4.5',
    knowledgeCutoff: '2025-02',
    releasedAt: '2025-10-16',
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
    contextWindowTokens: 139_000,
    description:
      'Claude Sonnet 4 can produce near-instant responses or extended step-by-step reasoning that users can see. API users can finely control how long the model thinks.',
    displayName: 'Claude Sonnet 4',
    family: 'claude-sonnet',
    generation: 'claude-4',
    id: 'claude-sonnet-4',
    knowledgeCutoff: '2025-01',
    releasedAt: '2025-05-23',
    settings: {
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },

  // Google Models
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 173_000,
    description:
      'Gemini 3.1 Pro Preview improves on Gemini 3 Pro with enhanced reasoning capabilities and adds medium thinking level support.',
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: true,
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'gemini-3.1-pro-preview',
    knowledgeCutoff: '2025-01',
    releasedAt: '2026-02-19',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 173_000,
    description:
      'Gemini 3 Flash is the smartest model built for speed, combining cutting-edge intelligence with excellent search grounding.',
    displayName: 'Gemini 3 Flash Preview',
    family: 'gemini',
    generation: 'gemini-3',
    id: 'gemini-3-flash-preview',
    knowledgeCutoff: '2025-01',
    releasedAt: '2025-12-17',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
    },
    contextWindowTokens: 173_000,
    description:
      'Gemini 2.5 Pro is Google’s most advanced reasoning model, able to reason over code, math, and STEM problems and analyze large datasets, codebases, and documents with long context.',
    displayName: 'Gemini 2.5 Pro',
    family: 'gemini',
    generation: 'gemini-2.5',
    id: 'gemini-2.5-pro',
    knowledgeCutoff: '2025-01',
    releasedAt: '2025-06-17',
    type: 'chat',
  },

  // Raptor Models
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 264_000,
    description: 'Raptor mini is a preview model optimized for code-related tasks.',
    displayName: 'Raptor mini',
    enabled: true,
    id: 'oswe-vscode-prime',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
    },
    contextWindowTokens: 264_000,
    description: 'Raptor mini is a preview model optimized for code-related tasks.',
    displayName: 'Raptor mini (Secondary)',
    id: 'oswe-vscode-secondary',
    settings: {
      extendParams: ['gpt5ReasoningEffort', 'textVerbosity'],
    },
    type: 'chat',
  },
];

export const allModels = [...githubCopilotChatModels];

export default allModels;
