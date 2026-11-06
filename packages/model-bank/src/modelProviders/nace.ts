import type { ModelProviderCard } from '../types';

export const NaceProvider: ModelProviderCard = {
  apiKeyUrl: 'https://console.nace.ai/dashboard/api-keys',
  chatModels: [],
  description:
    'Nace serves the Drex decision models through the System One API: typed yes/no, choice, and score questions answered with calibrated probabilities instead of generated text.',
  id: 'nace',
  modelsUrl: 'https://console.nace.ai/docs/drex/reference/models',
  name: 'Nace',
  settings: {
    modelEditable: false,
    proxyUrl: {
      placeholder: 'https://console.nace.ai/v1',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://nace.ai',
};
