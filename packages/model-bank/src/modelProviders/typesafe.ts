import type { ModelProviderCard } from '../types';

export const TypeSafeProvider: ModelProviderCard = {
  apiKeyUrl: 'https://console.typesafe.ai/',
  chatModels: [],
  description:
    'TypeSafe provides System One models that answer typed questions with calibrated probabilities for reliable application decisions.',
  id: 'typesafe',
  modelsUrl: 'https://docs.typesafe.ai/models',
  name: 'TypeSafe',
  settings: {
    modelEditable: false,
    proxyUrl: {
      placeholder: 'https://api.typesafe.ai/v1',
    },
    showAddNewModel: false,
    showChecker: false,
    showModelFetcher: false,
  },
  url: 'https://typesafe.ai',
};
