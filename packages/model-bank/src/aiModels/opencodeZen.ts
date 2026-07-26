import { type AIChatModelCard } from '../types/aiModel';

// ref: https://opencode.ai/zen
// Models synced from https://models.dev/api.json → opencode (OpenCode Zen)
// `settings.extendParams` follows each model's `reasoning_options`.

const opencodeZenChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Top Claude Opus tier for the hardest reasoning, coding, and long-horizon agents',
    displayName: 'Claude Opus 4.8',
    enabled: false,
    family: 'claude-opus',
    id: 'claude-opus-4-8',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-28',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['enableAdaptiveThinking', 'opus47Effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Everyday Claude agent model for coding, planning, browsing, and general work',
    displayName: 'Claude Sonnet 5',
    enabled: false,
    family: 'claude-sonnet',
    id: 'claude-sonnet-5',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-30',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['enableAdaptiveThinking', 'opus47Effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Flagship Claude model for deep reasoning, coding, and long-horizon agents',
    displayName: 'Claude Opus 4.7',
    enabled: false,
    family: 'claude-opus',
    id: 'claude-opus-4-7',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-16',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['enableAdaptiveThinking', 'opus47Effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Balanced Claude model for coding, analysis, agent workflows, and cost control',
    displayName: 'Claude Sonnet 4.6',
    enabled: false,
    family: 'claude-sonnet',
    id: 'claude-sonnet-4-6',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-17',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "max"]}, {"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'enableAdaptiveThinking', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'High-end Claude for difficult coding, planning, and slower expert reasoning',
    displayName: 'Claude Opus 4.6',
    enabled: false,
    family: 'claude-opus',
    id: 'claude-opus-4-6',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-05',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "max"]}, {"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'enableAdaptiveThinking', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'Flagship Claude model for deep reasoning, coding, and long-horizon agents',
    displayName: 'Claude Opus 4.5',
    enabled: false,
    family: 'claude-opus',
    id: 'claude-opus-4-5',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-24',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}, {"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken', 'effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Claude model for creative writing, analysis, and controlled agent workflows',
    displayName: 'Claude Fable 5',
    enabled: false,
    family: 'claude-mythos',
    generation: 'mythos-5',
    id: 'claude-fable-5',
    maxOutput: 128_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 50, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 12.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-09',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['enableAdaptiveThinking', 'opus47Effort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Balanced Claude model for coding, analysis, agent workflows, and cost control',
    displayName: 'Claude Sonnet 4.5',
    enabled: false,
    family: 'claude-sonnet',
    id: 'claude-sonnet-4-5',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-29',
    settings: {
      // reasoning_options: [{"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_000_000,
    description: 'Balanced Claude model for coding, analysis, agent workflows, and cost control',
    displayName: 'Claude Sonnet 4',
    enabled: false,
    family: 'claude-sonnet',
    id: 'claude-sonnet-4',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-05-22',
    settings: {
      // reasoning_options: [{"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description: 'Flagship Claude model for deep reasoning, coding, and long-horizon agents',
    displayName: 'Claude Opus 4.1',
    enabled: false,
    family: 'claude-opus',
    id: 'claude-opus-4-1',
    maxOutput: 32_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 18.75, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-05',
    settings: {
      // reasoning_options: [{"type": "budget_tokens", "min": 1024}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 200_000,
    description:
      'Fast Claude model for responsive assistance, classification, and lightweight agents',
    displayName: 'Claude Haiku 4.5',
    enabled: false,
    family: 'claude-haiku',
    id: 'claude-haiku-4-5',
    maxOutput: 64_000,
    organization: 'Anthropic',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-15',
    settings: {
      // reasoning_options: [{"type": "budget_tokens", "min": 1024}]
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
    contextWindowTokens: 1_050_000,
    description:
      'Frontier GPT-5.6 model for complex professional work, coding, and agentic workflows',
    displayName: 'GPT-5.6 Sol',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-sol',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 6.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['gpt5_6ReasoningEffort'],
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
    contextWindowTokens: 1_050_000,
    description: 'Balanced GPT-5.6 model for capable, cost-efficient everyday work',
    displayName: 'GPT-5.6 Terra',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-terra',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 3.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['gpt5_6ReasoningEffort'],
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
    contextWindowTokens: 1_050_000,
    description: 'Cost-efficient GPT-5.6 model for fast, high-volume workloads',
    displayName: 'GPT-5.6 Luna',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.6',
    id: 'gpt-5.6-luna',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-09',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh", "max"]}]
      extendParams: ['gpt5_6ReasoningEffort'],
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
    contextWindowTokens: 1_050_000,
    description: 'Default frontier GPT for coding, computer use, research, and knowledge work',
    displayName: 'GPT-5.5',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-23',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_050_000,
    description: 'Frontier GPT model for professional reasoning, coding, and multimodal work',
    displayName: 'GPT-5.5 Pro',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.5',
    id: 'gpt-5.5-pro',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 180, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ProReasoningEffort'],
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
    contextWindowTokens: 1_050_000,
    description: 'Agent-ready GPT for coding and computer-use workflows at a lower cost',
    displayName: 'GPT-5.4',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-05',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, vision: true },
    contextWindowTokens: 1_050_000,
    description: 'Frontier GPT model for professional reasoning, coding, and multimodal work',
    displayName: 'GPT-5.4 Pro',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-pro',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 180, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 30, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-05',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ProReasoningEffort'],
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
    description: 'Compact GPT model for low-latency assistance and high-volume workloads',
    displayName: 'GPT-5.4 Mini',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-mini',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.075, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-17',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
    description: 'Compact GPT model for low-latency assistance and high-volume workloads',
    displayName: 'GPT-5.4 Nano',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4-nano',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-17',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.3 Codex',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.3',
    id: 'gpt-5.3-codex',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-24',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 128_000,
    description:
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.3 Codex Spark',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.3',
    id: 'gpt-5.3-codex-spark',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
    description: 'GPT model for general reasoning, writing, coding, and tool-assisted tasks',
    displayName: 'GPT-5.2',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-11',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.2 Codex',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.2',
    id: 'gpt-5.2-codex',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.75, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.175, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-14',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
    description: 'GPT model for general reasoning, writing, coding, and tool-assisted tasks',
    displayName: 'GPT-5.1',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.107, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "low", "medium", "high"]}]
      extendParams: ['gpt5_1ReasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.1 Codex',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-codex',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.107, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['reasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.1 Codex Max',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-codex-max',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 10, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.125, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high", "xhigh"]}]
      extendParams: ['gpt5_2ReasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5.1 Codex Mini',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5.1',
    id: 'gpt-5.1-codex-mini',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.025, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-11-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['reasoningEffort'],
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
    description: 'GPT model for general reasoning, writing, coding, and tool-assisted tasks',
    displayName: 'GPT-5',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.107, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["minimal", "low", "medium", "high"]}]
      extendParams: ['gpt5ReasoningEffort'],
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
      'Coding-optimized GPT model for repository edits, reviews, and agentic software work',
    displayName: 'GPT-5 Codex',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-codex',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.07, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 8.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.107, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-09-15',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['reasoningEffort'],
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
    description: 'Compact GPT model for low-latency assistance and high-volume workloads',
    displayName: 'GPT-5 Nano',
    enabled: false,
    family: 'gpt',
    generation: 'gpt-5',
    id: 'gpt-5-nano',
    maxOutput: 128_000,
    organization: 'OpenAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.005, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-08-07',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["minimal", "low", "medium", "high"]}]
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_048_576,
    description: 'Fast Gemini model balancing multimodal reasoning, tool use, and cost',
    displayName: 'Gemini 3.5 Flash',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-3.5',
    id: 'gemini-3.5-flash',
    maxOutput: 65_536,
    organization: 'Google',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 9, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-19',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["minimal", "low", "medium", "high"]}]
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_048_576,
    description: 'Advanced Gemini model for complex reasoning, coding, and multimodal analysis',
    displayName: 'Gemini 3.1 Pro Preview',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-3.1',
    id: 'gemini-3.1-pro',
    maxOutput: 65_536,
    organization: 'Google',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 12, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-19',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['reasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_048_576,
    description: 'Fast Gemini model balancing multimodal reasoning, tool use, and cost',
    displayName: 'Gemini 3 Flash',
    enabled: false,
    family: 'gemini',
    generation: 'gemini-3',
    id: 'gemini-3-flash',
    maxOutput: 65_536,
    organization: 'Google',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-12-17',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["minimal", "low", "medium", "high"]}]
      extendParams: ['gpt5ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Open flagship GLM for long-horizon coding agents and million-token context work',
    displayName: 'GLM-5.2',
    enabled: false,
    family: 'glm',
    generation: 'glm-5.2',
    id: 'glm-5.2',
    maxOutput: 131_072,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-13',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["high", "max"]}]
      extendParams: ['glm5_2ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'Flagship GLM model for hybrid reasoning, coding, and agentic engineering',
    displayName: 'GLM-5.1',
    enabled: false,
    family: 'glm',
    generation: 'glm-5.1',
    id: 'glm-5.1',
    maxOutput: 131_072,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4.4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.26, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-07',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'Flagship GLM model for hybrid reasoning, coding, and agentic engineering',
    displayName: 'GLM-5',
    enabled: false,
    family: 'glm',
    generation: 'glm-5',
    id: 'glm-5',
    maxOutput: 131_072,
    organization: 'Zhipu',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-11',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Open MoE flagship with million-token context for coding and long agent runs',
    displayName: 'DeepSeek V4 Pro',
    enabled: false,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-pro',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1.74, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3.84, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.145, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "effort", "values": ["high", "max"]}]
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 1_000_000,
    description: 'Fast DeepSeek V4 lane for economical reasoning, coding, and long-context work',
    displayName: 'DeepSeek V4 Flash',
    enabled: false,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash',
    maxOutput: 384_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.14, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0.28, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.028, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "effort", "values": ["high", "max"]}]
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 200_000,
    description: 'Fast DeepSeek model for efficient chat, coding help, and agent loops',
    displayName: 'DeepSeek V4 Flash Free',
    enabled: true,
    family: 'deepseek',
    generation: 'deepseek-v4',
    id: 'deepseek-v4-flash-free',
    maxOutput: 128_000,
    organization: 'DeepSeek',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "effort", "values": ["high", "max"]}]
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Coding-focused Kimi model, stronger on long-horizon repo work with less overthinking',
    displayName: 'Kimi K2.7 Code',
    enabled: false,
    family: 'kimi',
    id: 'kimi-k2.7-code',
    maxOutput: 262_144,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.19, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Kimi multimodal agent model for visual understanding, coding, and planning',
    displayName: 'Kimi K2.6',
    enabled: false,
    family: 'kimi',
    id: 'kimi-k2.6',
    maxOutput: 65_536,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.95, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 4, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.16, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-21',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Kimi multimodal agent model for visual understanding, coding, and planning',
    displayName: 'Kimi K2.5',
    enabled: false,
    family: 'kimi',
    id: 'kimi-k2.5',
    maxOutput: 65_536,
    organization: 'Moonshot',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.08, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-01-27',
    settings: {
      // reasoning_options: [{"type": "toggle"}]
      extendParams: ['enableReasoning'],
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
    contextWindowTokens: 500_000,
    description: "xAI's latest Grok for chat, coding, agentic tools, and lower hallucination risk",
    displayName: 'Grok 4.5',
    enabled: false,
    family: 'grok',
    generation: 'grok-4.5',
    id: 'grok-4.5',
    maxOutput: 500_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-08',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["low", "medium", "high"]}]
      extendParams: ['grok4_5ReasoningEffort'],
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
    contextWindowTokens: 256_000,
    description: 'Grok coding model for agentic engineering, edits, and codebase workflows',
    displayName: 'Grok Build 0.1',
    enabled: false,
    family: 'grok',
    generation: 'grok-build',
    id: 'grok-build-0.1',
    maxOutput: 256_000,
    organization: 'xAI',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-05-20',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Multimodal reasoning model for visual analysis, planning, and tool use',
    displayName: 'Qwen3.6 Plus',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.6',
    id: 'qwen3.6-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.05, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.625, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-02',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "budget_tokens", "max": 81920}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Multimodal reasoning model for visual analysis, planning, and tool use',
    displayName: 'Qwen3.5 Plus',
    enabled: false,
    family: 'qwen',
    generation: 'qwen3.5',
    id: 'qwen3.5-plus',
    maxOutput: 65_536,
    organization: 'Alibaba',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.02, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0.25, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-16',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "budget_tokens", "max": 81920}]
      extendParams: ['enableReasoning', 'reasoningBudgetToken80k'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 512_000,
    description: 'MiniMax multimodal model for long-context coding, perception, and agent planning',
    displayName: 'MiniMax-M3',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m3',
    id: 'minimax-m3',
    maxOutput: 128_000,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-01',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2.7',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.7',
    id: 'minimax-m2.7',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-03-18',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 204_800,
    description: 'MiniMax model for chat, coding, office work, and agentic tasks',
    displayName: 'MiniMax-M2.5',
    enabled: false,
    family: 'minimax',
    generation: 'minimax-m2.5',
    id: 'minimax-m2.5',
    maxOutput: 131_072,
    organization: 'MiniMax',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 1.2, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0.06, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-02-12',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 200_000,
    description: 'MiMo omni model for text, image, video, audio, and agents',
    displayName: 'MiMo V2.5 Free',
    enabled: true,
    family: 'mimo',
    id: 'mimo-v2.5-free',
    maxOutput: 32_000,
    organization: 'Xiaomi',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-24',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 200_000,
    description:
      'Reasoning model for deliberate analysis, multi-step problem solving, and tool use',
    displayName: 'Big Pickle',
    enabled: true,
    family: 'big-pickle',
    id: 'big-pickle',
    maxOutput: 32_000,
    organization: 'OpenCode',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheWrite', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2025-10-17',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 1_000_000,
    description: 'Largest Nemotron 3 model for maximum open-weight reasoning and agent accuracy',
    displayName: 'Nemotron 3 Ultra Free',
    enabled: true,
    family: 'nemotron',
    generation: 'nemotron-3',
    id: 'nemotron-3-ultra-free',
    maxOutput: 128_000,
    organization: 'NVIDIA',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-04',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true },
    contextWindowTokens: 190_000,
    description: 'Tencent Hy reasoning model for coding, instruction following, and agent tasks',
    displayName: 'Hy3 Free',
    enabled: true,
    family: 'hunyuan',
    id: 'hy3-free',
    maxOutput: 64_000,
    organization: 'Tencent',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput_cacheRead', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-26',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 256_000,
    description: 'Cohere coding model for practical software engineering and agentic edits',
    displayName: 'North Mini Code Free',
    enabled: true,
    family: 'north',
    id: 'north-mini-code-free',
    maxOutput: 64_000,
    organization: 'Cohere',
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-09',
    settings: {
      // reasoning_options: [{"type": "effort", "values": ["none", "high"]}]
      extendParams: ['deepseekV4ReasoningEffort'],
    },
    type: 'chat',
  },
];

export default opencodeZenChatModels;
