import type { AIChatModelCard } from '../../../types/aiModel';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { openaiChatModels } from './openai';
import { xaiChatModels } from './xai';

export const lobehubChatModels: AIChatModelCard[] = [
  ...anthropicChatModels,
  ...googleChatModels,
  ...openaiChatModels,
  ...deepseekChatModels,
  ...xaiChatModels,
  ...minimaxChatModels,
  ...moonshotChatModels,
];

export { anthropicChatModels } from './anthropic';
export { deepseekChatModels } from './deepseek';
export { googleChatModels } from './google';
export { minimaxChatModels } from './minimax';
export { moonshotChatModels } from './moonshot';
export { openaiChatModels } from './openai';
export { xaiChatModels } from './xai';
