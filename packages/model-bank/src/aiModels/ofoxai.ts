import type { AIChatModelCard } from '../types/aiModel';

// OfoxAI is an API gateway — models are fetched dynamically
const ofoxaiChatModels: AIChatModelCard[] = [];

export const allModels = [...ofoxaiChatModels];

export default allModels;
