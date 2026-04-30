import type { AIChatModelCard } from '../types/aiModel';

// Manifest - Open-source LLM router
// Models are fetched dynamically, not predefined
const manifestChatModels: AIChatModelCard[] = [];

export const allModels = [...manifestChatModels];

export default allModels;
