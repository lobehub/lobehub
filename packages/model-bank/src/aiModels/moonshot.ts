import type { AIChatModelCard } from '../types/aiModel';

// https://platform.kimi.ai/docs/pricing/chat
const moonshotChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 1_048_576,
    description:
      "Kimi K3 is Kimi's most capable model to date, with 2.8 trillion parameters. Built on Kimi Delta Attention and Attention Residuals, it offers native visual understanding and a 1M-token context window for frontier intelligence scenarios such as software engineering, knowledge work, and deep reasoning. Reasoning is always on, configured via the top-level reasoning_effort field.",
    displayName: 'Kimi K3',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k3',
    id: 'kimi-k3',
    maxOutput: 131_072,
    pricing: {
      currency: 'USD',
      units: [
        { name: 'textInput_cacheRead', rate: 0.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 15, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-07-16',
    settings: {
      // K3 fixes sampling params server-side (temperature=1, top_p=0.95, penalties=0)
      // and the API docs advise against sending them
      disabledParams: ['frequency_penalty', 'presence_penalty', 'temperature', 'top_p'],
      extendParams: ['kimiK3ReasoningEffort'],
    },
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.7 Code is Kimi's most intelligent coding model to date. It can follow instructions more reliably in long contexts and complete programming tasks with a higher success rate. It also supports text, image and video input, thinking mode, dialogue and Agent tasks.",
    displayName: 'Kimi K2.7 Code',
    enabled: true,
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1.3, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 6.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-12',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      'Kimi K2.7 Code HighSpeed ​​is a high-speed model of Kimi K2.7 Code. It is the same model as Kimi K2.7 Code, but the output speed is about 180 Tokens/s, and the short context scenario can reach 260 Tokens/s, bringing a more extreme programming experience.',
    displayName: 'Kimi K2.7 Code HighSpeed',
    family: 'kimi',
    generation: 'kimi-k2.7',
    id: 'kimi-k2.7-code-highspeed',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 2.6, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 13, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 54, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-06-15',
    type: 'chat',
  },
  {
    abilities: {
      functionCall: true,
      reasoning: true,
      structuredOutput: true,
      video: true,
      vision: true,
    },
    contextWindowTokens: 262_144,
    description:
      "Kimi K2.6 is Kimi's latest and most capable model, delivering stronger long-horizon coding, instruction following, and self-correction while supporting text, image, and video inputs plus chat and agent tasks.",
    displayName: 'Kimi K2.6',
    family: 'kimi',
    generation: 'kimi-k2.6',
    id: 'kimi-k2.6',
    maxOutput: 32_768,
    pricing: {
      currency: 'CNY',
      units: [
        { name: 'textInput_cacheRead', rate: 1.1, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textInput', rate: 6.5, strategy: 'fixed', unit: 'millionTokens' },
        { name: 'textOutput', rate: 27, strategy: 'fixed', unit: 'millionTokens' },
      ],
    },
    releasedAt: '2026-04-20',
    settings: {
      extendParams: ['enableReasoning', 'preserveThinking'],
    },
    type: 'chat',
  },
];

export const allModels = [...moonshotChatModels];

export default allModels;
