import type { AIChatModelCard } from '../types/aiModel';

// NewAPI Router Provider - Aggregates multiple AI services
// Models are fetched dynamically, not predefined
const newapiChatModels: AIChatModelCard[] = [
  // NewAPI as router provider, model list fetched dynamically via API
];

export const allModels = [...newapiChatModels];

export default allModels;
