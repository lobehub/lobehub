import type { AIChatModelCard } from '../../../types/aiModel';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { mappingChatModels } from './mapping';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { openaiChatModels } from './openai';
import { xaiChatModels } from './xai';
import { xiaomimimoChatModels } from './xiaomimimo';
import { zhipuChatModels } from './zhipu';

export const lobehubChatModels: AIChatModelCard[] = [
  ...deepseekChatModels,
  ...anthropicChatModels,
  ...googleChatModels,
  ...openaiChatModels,
  ...xaiChatModels,
  ...moonshotChatModels,
  ...minimaxChatModels,
  ...zhipuChatModels,
  ...xiaomimimoChatModels,
  ...mappingChatModels,
];

export { anthropicChatModels } from './anthropic';
export { deepseekChatModels } from './deepseek';
export { googleChatModels } from './google';
export { mappingChatModels } from './mapping';
export { minimaxChatModels } from './minimax';
export { moonshotChatModels } from './moonshot';
export { openaiChatModels } from './openai';
export { xaiChatModels } from './xai';
export { xiaomimimoChatModels } from './xiaomimimo';
export { zhipuChatModels } from './zhipu';
