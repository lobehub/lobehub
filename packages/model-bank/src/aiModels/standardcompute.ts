import type { AIChatModelCard } from '../types/aiModel';

// The full catalog comes from the gateway's public /v1/models. Only the routed
// model is listed here: it picks the cheapest capable model for each request.
// No per-model prices are published, so pricing is left unset.
const standardComputeChatModels: AIChatModelCard[] = [
  {
    abilities: {
      functionCall: true,
      reasoning: true,
    },
    contextWindowTokens: 1_000_000,
    description: 'Routes each request to the cheapest capable model.',
    displayName: 'Standard Compute',
    enabled: true,
    id: 'StandardCompute',
    type: 'chat',
  },
];

export const allModels = [...standardComputeChatModels];

export default allModels;
