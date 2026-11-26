import type { ModelProviderCard } from '../types';

const SteadyRouter: ModelProviderCard = {
  apiKeyUrl: 'https://www.steadyrouter.com/sign-up?aff=Dn19',
  chatModels: [],
  checkModel: 'gpt-5.4-mini',
  description:
    'One API key for hundreds of models, with automatic failover between upstream sources.',
  id: 'steadyrouter',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://www.steadyrouter.com/pricing',
  name: 'SteadyRouter',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.steadyrouter.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.steadyrouter.com',
};

export default SteadyRouter;
