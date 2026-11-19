import type { ModelProviderCard } from '../types';

// NagaAI is an API gateway: models from many vendors on one OpenAI-compatible
// endpoint, with ids in `vendor/model` form. The list changes with the gateway's
// catalog, so `chatModels` stays empty and models come from its public
// /v1/models. See https://docs.naga.ac
const NagaAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'google/gemini-3.5-flash',
  description:
    'NagaAI is an API gateway that serves models from many vendors on one OpenAI-compatible endpoint.',
  id: 'nagaai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://naga.ac/models',
  name: 'NagaAI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.naga.ac/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://naga.ac',
};

export default NagaAI;
