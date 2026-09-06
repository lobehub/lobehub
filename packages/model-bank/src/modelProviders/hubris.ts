import type { ModelProviderCard } from '../types';

// ref: https://hubris.pw/models
const Hubris: ModelProviderCard = {
  chatModels: [],
  checkModel: 'google/gemini-3.7-flash',
  description:
    'Hubris is an OpenAI-compatible gateway that serves models from Anthropic, OpenAI, Google, DeepSeek, Moonshot, xAI and others behind one API key, with billing in Russian roubles.',
  id: 'hubris',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://hubris.pw/models',
  name: 'Hubris',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.hubris.pw/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://hubris.pw',
};

export default Hubris;
