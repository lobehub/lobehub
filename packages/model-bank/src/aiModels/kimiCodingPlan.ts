import { type AIChatModelCard } from '../types/aiModel';

// ref: https://www.kimi.com/code/docs/en/third-party-tools/other-coding-agents.html
// Models synced from https://models.dev/api.json → kimi-for-coding

const kimiCodingPlanChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      vision: true,
      video: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      'Multimodal Kimi model with 1M context and toggleable max-effort thinking for long-horizon agent work',
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'k3',
    maxOutput: 131_072,
    organization: 'Moonshot',
    releasedAt: '2026-07-16',
    settings: {
      // reasoning_options: [{"type": "toggle"}, {"type": "effort", "values": ["max"]}]
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
      video: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Coding-focused Kimi model, stronger on long-horizon repo work with less overthinking',
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'k2p7',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-06-12',
    // reasoning_options: []
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
    description: 'Kimi reasoning model for long-horizon research, planning, and tool use',
    displayName: 'Kimi K2.6',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'k2p6',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-04-01',
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
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Kimi reasoning model for long-horizon research, planning, and tool use',
    displayName: 'Kimi K2.5',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2.5',
    id: 'k2p5',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-01-01',
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
      video: true,
    },
    contextWindowTokens: 262_144,
    description: 'Lower-latency Kimi Code variant for interactive edits and coding-agent loops',
    displayName: 'Kimi For Coding HighSpeed',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-for-coding-highspeed',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2026-06-12',
    // reasoning_options: []
    type: 'chat',
  },
  {
    abilities: { functionCall: true, reasoning: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description: 'Kimi reasoning model for long-horizon research, planning, and tool use',
    displayName: 'Kimi K2 Thinking',
    enabled: false,
    family: 'kimi',
    generation: 'kimi-k2',
    id: 'kimi-k2-thinking',
    maxOutput: 32_768,
    organization: 'Moonshot',
    releasedAt: '2025-11-01',
    // reasoning_options: []
    type: 'chat',
  },
];

export default kimiCodingPlanChatModels;
