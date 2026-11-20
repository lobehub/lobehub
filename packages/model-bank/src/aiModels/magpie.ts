import type { AIChatModelCard } from '../types/aiModel';

// magpie serves the models its user has: subscriptions, API keys, local models
// and routing groups, each with the id magpie gives it. The list is the user's
// own, so it is fetched from the gateway's /v1/models and nothing is predefined
// here.
const magpieChatModels: AIChatModelCard[] = [];

export const allModels = [...magpieChatModels];

export default allModels;
