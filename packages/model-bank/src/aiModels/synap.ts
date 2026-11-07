import type { AIChatModelCard } from '../types/aiModel';

// Synap serves whatever its own catalog currently has live — self-hosted fleet
// models plus the external models its paid "pro" router adds — so the list is
// fetched from the gateway's /v1/models and nothing is predefined here.
const synapChatModels: AIChatModelCard[] = [];

export const allModels = [...synapChatModels];

export default allModels;
