import type { AIChatModelCard } from '../types/aiModel';

// ref: https://cheaperinference.com/#models
const cheaperInferenceChatModels: AIChatModelCard[] = [
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
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      vision: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'GPT-5.4 is the frontier model for complex professional work with highest reasoning capability.',
    displayName: 'GPT-5.4',
    enabled: true,
    family: 'gpt',
    generation: 'gpt-5.4',
    id: 'gpt-5.4',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      "Claude Sonnet 5 is Anthropic's most agentic Sonnet model, built for sustained coding, tool use, and long-context workflows with Sonnet-tier speed and efficiency.",
    displayName: 'Claude Sonnet 5',
    enabled: true,
    family: 'claude-sonnet',
    generation: 'claude-5',
    id: 'claude-sonnet-5',
    maxOutput: 64_000,
    type: 'chat',
  },
];

export const allModels = [...cheaperInferenceChatModels];

export default allModels;
