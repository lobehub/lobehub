import type { AIChatModelCard } from '../../../types/aiModel';
import { anthropicChatModels } from './anthropic';
import { deepseekChatModels } from './deepseek';
import { googleChatModels } from './google';
import { minimaxChatModels } from './minimax';
import { moonshotChatModels } from './moonshot';
import { openaiChatModels } from './openai';
import { runtimeOnlyChatModels } from './runtimeOnly';
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
  ...runtimeOnlyChatModels,
];

export { anthropicChatModels } from './anthropic';
export { deepseekChatModels } from './deepseek';
export { googleChatModels } from './google';
export { minimaxChatModels } from './minimax';
export { moonshotChatModels } from './moonshot';
export { openaiChatModels } from './openai';
export { runtimeOnlyChatModels } from './runtimeOnly';
export { xaiChatModels } from './xai';
export { xiaomimimoChatModels } from './xiaomimimo';
export { zhipuChatModels } from './zhipu';
