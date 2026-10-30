import type { AIChatModelCard } from '../types/aiModel';

// AI Stupid Level routes each request to a model chosen for the routing mode, among the providers
// the user connected, so these ids are routing modes rather than one lab's model. A model id
// from the live list (GET /v1/models) pins that model. Limits are the smallest across the pool.
//
// No `pricing` block: the router adds no per-token charge and calls the chosen model with the
// user's own provider key, so the cost is that provider's price for whichever model is picked.

const aistupidlevelChatModels: AIChatModelCard[] = [
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the model with the best combined score across the coding, reasoning and tool-use benchmarks.",
    displayName: "Best overall",
    enabled: true,
    id: 'auto-best',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the model that scores best on the coding benchmark.",
    displayName: "Best for coding",
    enabled: true,
    id: 'auto-coding',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the model that scores best on the multi-turn reasoning benchmark.",
    displayName: "Best for reasoning",
    enabled: true,
    id: 'auto-reasoning',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the model that scores best on the tool-use benchmark; suits agents.",
    displayName: "Best for tool use",
    enabled: true,
    id: 'auto-tooling',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Reads each request and routes it to the coding, reasoning or tool-use leader accordingly.",
    displayName: "Matched to each request",
    enabled: false,
    id: 'auto-task',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the model with the best score per dollar among the near-top models.",
    displayName: "Best value",
    enabled: false,
    id: 'auto-value',
    maxOutput: 64_000,
    type: 'chat',
  },
  {
    abilities: { functionCall: true, structuredOutput: true },
    contextWindowTokens: 262_144,
    description:
      "Sends each request to the fastest of the models that score near the top.",
    displayName: "Fastest strong model",
    enabled: false,
    id: 'auto-fastest-quality',
    maxOutput: 64_000,
    type: 'chat',
  },
];

export const allModels = [...aistupidlevelChatModels];

export default allModels;
