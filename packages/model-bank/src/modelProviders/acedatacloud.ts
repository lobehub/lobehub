import type { ModelProviderCard } from '../types';

export const AceDataCloudProvider: ModelProviderCard = {
  apiKeyUrl:
    'https://platform.acedata.cloud/console/applications?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=lobehub_provider_api_key',
  chatModels: [],
  description: 'Ace Data Cloud provides API access to chat models with usage-based billing.',
  id: 'acedatacloud',
  modelsUrl:
    'https://platform.acedata.cloud/models?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=lobehub_provider_models',
  name: 'Ace Data Cloud',
  settings: {
    proxyUrl: { placeholder: 'https://api.acedata.cloud/v1' },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://acedata.cloud?utm_source=opensource&utm_medium=referral&utm_campaign=evergreen&utm_content=lobehub_provider_home',
};
