import type { ModelProviderCard } from '../types';

// magpie is an LLM gateway: every model the user has in magpie —
// subscriptions, API keys, local models, routing groups — is served there under
// one id each, so this is one provider entry rather than one per vendor.
//
// The model list is the user's own configuration, so it is never shipped here:
// `chatModels` stays empty and the catalog comes from the gateway's /v1/models.
// See https://usemagpie.ai/docs/integrate
const Magpie: ModelProviderCard = {
  chatModels: [],
  description:
    'magpie is an LLM gateway: every model and subscription you have there is served on one endpoint.',
  id: 'magpie',
  name: 'magpie',
  settings: {
    // magpie is a desktop app on the user's own machine, so on the web the
    // browser sends the requests and the switch starts on; it is offered either
    // way, and a deployment reaching a magpie elsewhere sets `MAGPIE_PROXY_URL`
    // to have the server send them instead.
    defaultShowBrowserRequest: true,
    proxyUrl: {
      // A base URL the user gives is used as it stands, `/v1` included, so the
      // placeholder has to carry it.
      placeholder: 'http://127.0.0.1:3425/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
    supportResponsesApi: true,
  },
  url: 'https://usemagpie.ai',
};

export default Magpie;
