import type { AIChatModelCard } from '../types/aiModel';

// Token Market's model catalog is fetched dynamically from the unified API.
const tokenmarketChatModels: AIChatModelCard[] = [];

export const allModels = [...tokenmarketChatModels];

export default allModels;
