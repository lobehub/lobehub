import type { AIChatModelCard } from '../types/aiModel';

// LiteLLM Proxy serves model aliases that the user sets in the proxy config.
// Models are fetched dynamically from `/v1/models`, not predefined.
const litellmChatModels: AIChatModelCard[] = [];

export const allModels = [...litellmChatModels];

export default allModels;
