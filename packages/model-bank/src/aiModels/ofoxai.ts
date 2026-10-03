import type { AIChatModelCard } from '../types/aiModel';

// OfoxAI is a unified API gateway - models are fetched dynamically via /v1/models
const ofoxaiChatModels: AIChatModelCard[] = [];

export const allModels = [...ofoxaiChatModels];

export default allModels;
