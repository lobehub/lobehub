import type { ModelProviderCard } from '../types';

// magpie is a local LLM gateway: every model the user has in magpie —
// subscriptions, API keys, local models, routing groups — is served there under
// one id each, so this is one provider entry rather than one per vendor.
//
// The model list is the user's own configuration, so it is never shipped here:
// `chatModels` stays empty and the catalog comes from the gateway's /v1/models.
// See https://usemagpie.ai/docs/integrate
const Magpie: ModelProviderCard = {
  chatModels: [],
  description:
    'magpie runs a local LLM gateway: every model and subscription you have there is served on one endpoint.',
  enabled: true,
  id: 'magpie',
  name: 'magpie',
  settings: {
    // The gateway only listens on loopback, so requests leave from the device
    // that runs magpie rather than from a remote server.
    defaultShowBrowserRequest: true,
    proxyUrl: {
      placeholder: 'http://127.0.0.1:3425',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://usemagpie.ai',
};

export default Magpie;
