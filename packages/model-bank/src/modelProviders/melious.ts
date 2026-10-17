import type { ModelProviderCard } from '../types';

const Melious: ModelProviderCard = {
  apiKeyUrl: 'https://melious.ai/account/api/keys',
  chatModels: [],
  checkModel: 'qwen3.5-9b',
  description:
    'Melious serves open-weight models on European infrastructure (GDPR/TTDSG) through an OpenAI-compatible API, and reports the energy use and cost of every response.',
  id: 'melious',
  modelsUrl: 'https://melious.ai/hub/models',
  name: 'Melious',
  settings: {
    // Melious restricts CORS to its own origins, so a browser-direct request from a
    // self-hosted deployment is rejected at preflight. Requests must go through the server.
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.melious.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://melious.ai',
};

export default Melious;
