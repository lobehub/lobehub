import { BRANDING_NAME, BRANDING_URL } from '@lobechat/business-const';

import type { ChatModelCard, ModelProviderCard } from '@/types/llm';

import cometapiModels from '../aiModels/cometapi';
import type { AIChatModelCard } from '../types/aiModel';

const featuredModels = [
  'gpt-5-chat-latest',
  'gpt-5-mini',
  'claude-sonnet-4-5',
  'gemini-2.5-pro',
  'deepseek-chat',
];

const chatModels = featuredModels
  .map((id) => cometapiModels.find((model) => model.id === id))
  .filter((model): model is AIChatModelCard => Boolean(model))
  .map((model) => ({
    ...model,
    description: model.description || `${BRANDING_NAME} AI модель через единый managed-провайдер.`,
    displayName: `${model.displayName || model.id}`,
    enabled: true,
  })) satisfies ChatModelCard[];

const LobeHub: ModelProviderCard = {
  chatModels,
  checkModel: 'gpt-5-mini',
  description: `${BRANDING_NAME} AI — управляемый доступ к лучшим моделям OpenAI, Anthropic, Google и DeepSeek через единый баланс и без ручной настройки ключей.`,
  enabled: true,
  id: 'lobehub',
  modelList: { showModelFetcher: false },
  modelsUrl: BRANDING_URL.subscription,
  name: `${BRANDING_NAME} AI`,
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: BRANDING_URL.support,
};

export default LobeHub;

export const planCardModels = [
  'gpt-5-chat-latest',
  'claude-sonnet-4-5',
  'gemini-2.5-pro',
  'deepseek-chat',
];
