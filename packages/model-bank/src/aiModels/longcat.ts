import type { AIChatModelCard } from '../types/aiModel';

const longcatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
    },
    contextWindowTokens: 1_000_000,
    description:
      'The core features of LongCat-2.0-Preview are as follows: Designed for agent development scenarios, with native support for tool use, multi-step reasoning, and long-context tasks; Excels in code generation, automated workflows, and complex instruction execution; Deeply integrated with productivity tools such as Claude Code, OpenClaw, OpenCode, and Kilo Code.',
    displayName: 'LongCat-2.0-Preview',
    enabled: true,
    family: 'longcat',
    generation: 'longcat-2.0',
    id: 'LongCat-2.0-Preview',
    maxOutput: 128_000,
    pricing: {
      units: [
        { name: 'textInput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 0, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    type: 'chat',
  },
];

export const allModels = [...longcatModels];

export default allModels;
