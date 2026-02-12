import type { ModelProviderCard } from '@/types/llm';

const LobeHub: ModelProviderCard = {
  chatModels: [],
  description:
    'LobeHub Cloud uses official APIs to access AI models and measures usage with Credits tied to model tokens.',
  enabled: true,
  id: 'lobehub',
  modelsUrl: 'https://lobehub.com/zh/docs/usage/subscription/model-pricing',
  name: 'LobeHub',
  settings: {
    modelEditable: false,
    showAddNewModel: false,
    showModelFetcher: false,
  },
  showConfig: false,
  url: 'https://lobehub.com',
};

export default LobeHub;

export const planCardModels = ['claude-sonnet-4-5-20250929', 'gemini-3-pro-preview', 'gpt-5.2', 'deepseek-chat'];
