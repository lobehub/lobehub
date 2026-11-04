import type { ModelProviderCard } from '../types';

// TokenLab is an OpenAI-compatible gateway. Its catalog changes as models are
// added and retired, so nothing is shipped here: `chatModels` stays empty and
// the list comes from `GET /v1/models`, which needs no key.
// ref: https://tokenlab.sh/en/pricing
const TokenLab: ModelProviderCard = {
  apiKeyUrl: 'https://tokenlab.sh/?utm_source=lobehub',
  chatModels: [],
  checkModel: 'gpt-6-luna',
  description:
    'TokenLab is an OpenAI-compatible API gateway for models from OpenAI, Anthropic, Google, DeepSeek, Moonshot and more, on one key with per-token billing.',
  id: 'tokenlab',
  modelsUrl: 'https://tokenlab.sh/en/pricing?utm_source=lobehub',
  name: 'TokenLab',
  settings: {
    // The gateway's CORS policy only admits TokenLab's own origins, so requests
    // are sent from the server.
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.tokenlab.sh/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://tokenlab.sh/?utm_source=lobehub',
};

export default TokenLab;
