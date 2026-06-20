import { BRANDING_NAME, BRANDING_URL } from '@lobechat/business-const';

import type { ModelProviderCard } from '@/types/llm';

const LobeHub: ModelProviderCard = {
  chatModels: [],
  description: `${BRANDING_NAME} AI предоставляет команде единый доступ к моделям и учитывает расходы в workspace credits.`,
  enabled: true,
  id: 'lobehub',
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
  'deepseek-v4-pro',
  'claude-sonnet-4-6',
  'gemini-3.1-pro-preview',
  'gpt-5.5',
];
