import type { ModelProviderCard } from '@/types/llm';

const GithubCopilot: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-4o',
  description: 'Access Claude, GPT, and Gemini models through your GitHub Copilot subscription.',
  id: 'githubcopilot',
  name: 'GitHub Copilot',
  settings: {
    authType: 'oauthDeviceFlow',
    oauthDeviceFlow: {
      clientId: 'Iv1.b507a08c87ecfe98',
      defaultPollingInterval: 5,
      deviceCodeEndpoint: 'https://github.com/login/device/code',
      scopes: ['read:user'],
      tokenEndpoint: 'https://github.com/login/oauth/access_token',
      tokenExchangeEndpoint: 'https://api.github.com/copilot_internal/v2/token',
    },
    sdkType: 'openai',
    showApiKey: false,
    showChecker: true,
  },
  url: 'https://github.com/features/copilot',
};

export default GithubCopilot;
