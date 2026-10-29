import type { AIChatModelCard } from '../types/aiModel';

// TokenLab's catalog is fetched from the gateway's /v1/models, so nothing is
// predefined here.
const tokenlabChatModels: AIChatModelCard[] = [];

export const allModels = [...tokenlabChatModels];

export default allModels;
