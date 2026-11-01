import type { ModelProviderCard } from '../types';

/**
 * ChatGPT subscription access to OpenAI models through the Codex OAuth device
 * flow and Responses API backend. The OAuth client id belongs to the public
 * Codex CLI client and does not require a client secret.
 */
const ChatGPT: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-5.5',
  description:
    'Use models included with your ChatGPT subscription through Codex, without an OpenAI Platform API key.',
  disableBrowserRequest: true,
  id: 'chatgpt',
  modelsUrl: 'https://learn.chatgpt.com/docs/models',
  name: 'ChatGPT',
  settings: {
    authType: 'oauthDeviceFlow',
    disableBrowserRequest: true,
    oauthDeviceFlow: {
      clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
      defaultPollingInterval: 8,
      deviceCodeEndpoint: 'https://auth.openai.com/api/accounts/deviceauth/usercode',
      refreshTokenGrant: true,
      scopes: [],
      tokenEndpoint: 'https://auth.openai.com/oauth/token',
      tokenExchangeEndpoint: 'https://auth.openai.com/api/accounts/deviceauth/token',
    },
    sdkType: 'openai',
    showApiKey: false,
    showChecker: true,
    showModelFetcher: false,
  },
  url: 'https://chatgpt.com',
};

export default ChatGPT;
