import { anthropicChatModels } from './anthropic';
import { googleChatModels } from './google';
import { openaiChatModels } from './openai';
import { openModelsChatModels } from './openModels';

// Public active chat models from https://quicksilverpro.io/pricing.json.
// Unverified cutoffs/output limits and unsupported 1-hour cache-write prices are omitted.
export const allModels = [
  ...anthropicChatModels,
  ...openaiChatModels,
  ...googleChatModels,
  ...openModelsChatModels,
];

export default allModels;
