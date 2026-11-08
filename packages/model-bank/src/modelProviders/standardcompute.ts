import type { ModelProviderCard } from '../types';

// Standard Compute is an OpenAI-compatible LLM gateway. Its catalog is served
// from the public `GET /v1/models`, so `chatModels` stays empty and the model
// bank only carries the routed `StandardCompute` model.
// See https://docs.standardcompute.com
const StandardCompute: ModelProviderCard = {
  chatModels: [],
  checkModel: 'StandardCompute',
  description:
    'Cost-optimized LLM gateway: one OpenAI-compatible API that routes each step to the cheapest capable model, with opt-in Europe/US rules.',
  id: 'standardcompute',
  modelsUrl: 'https://docs.standardcompute.com',
  name: 'Standard Compute',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.stdcmpt.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://standardcompute.com',
};

export default StandardCompute;
