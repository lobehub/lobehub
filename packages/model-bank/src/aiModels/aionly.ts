import type { AIChatModelCard } from '../types/aiModel';

import anthropicChatModels from './anthropic';
import deepseekChatModels from './deepseek';
import googleChatModels from './google';
import openaiChatModels from './openai';
import qwenChatModels from './qwen';

const pickModel = (models: readonly { id: string }[], id: string): AIChatModelCard => {
  const model = models.find((item) => item.id === id);
  if (!model) {
    throw new Error(`Missing AiOnly model card: ${id}`);
  }
  return model as AIChatModelCard;
};

const enableModel = (model: AIChatModelCard): AIChatModelCard => ({
  ...model,
  enabled: true,
});

export const aionlyChatModels: AIChatModelCard[] = [
  enableModel(pickModel(anthropicChatModels, 'claude-opus-4-8')),
  enableModel(pickModel(anthropicChatModels, 'claude-sonnet-5')),
  enableModel(pickModel(openaiChatModels, 'gpt-5.5')),
  enableModel(pickModel(openaiChatModels, 'gpt-5.4')),
  enableModel(pickModel(googleChatModels, 'gemini-3.1-pro-preview')),
  enableModel(pickModel(googleChatModels, 'gemini-2.5-pro')),
  enableModel(pickModel(deepseekChatModels, 'deepseek-v4-pro')),
  enableModel(pickModel(qwenChatModels, 'glm-5.2')),
  enableModel(pickModel(qwenChatModels, 'qwen3.7-plus')),
];

export const allModels = [...aionlyChatModels];

export default allModels;
