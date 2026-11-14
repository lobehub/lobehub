import type { AIChatModelCard } from '../types/aiModel';

// NagaAI's catalog is fetched from the gateway's /v1/models, so nothing is
// predefined here.
const nagaaiChatModels: AIChatModelCard[] = [];

export const allModels = [...nagaaiChatModels];

export default allModels;
