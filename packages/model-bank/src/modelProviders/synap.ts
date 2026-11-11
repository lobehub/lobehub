import type { ModelProviderCard } from '../types';

// ref: https://synap402.com/models.html
const Synap: ModelProviderCard = {
  apiKeyUrl: 'https://synap402.com/account.html#keys',
  chatModels: [],
  checkModel: 'gpt-oss-20b',
  description:
    'Synap is a model gateway for open-weight models: pick a model and its price, or let synap-v1 route to the cheapest one that can do the job. Every request is checked against a zero-data-retention allowlist before it leaves.',
  id: 'synap',
  modelsUrl: 'https://synap402.com/models.html',
  name: 'Synap',
  settings: {
    // Synap's API has no CORS preflight handling, so a browser request fails
    // before it reaches the auth check.
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://synap402.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://synap402.com',
};

export default Synap;
