import type { ModelProviderCard } from '@/types/llm';

/**
 * @see https://docs.modelslab.com
 */
const ModelsLab: ModelProviderCard = {
  apiKeyUrl: 'https://modelslab.com/account/api-key',
  chatModels: [],
  checkModel: 'meta-llama/Meta-Llama-3-8B-Instruct',
  description:
    'ModelsLab is a developer-first AI API platform for text-to-image, video, voice, and uncensored chat generation.',
  id: 'modelslab',
  modelsUrl: 'https://docs.modelslab.com',
  name: 'ModelsLab',
  settings: {
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://modelslab.com',
};

export default ModelsLab;
