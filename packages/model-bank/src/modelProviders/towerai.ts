import type { ModelProviderCard } from '@/types/llm';

const TowerAI: ModelProviderCard = {
  chatModels: [],
  description:
    'Tower AI is an enterprise AI platform providing access to GPT, Claude, Gemini, and DeepSeek models via a unified proxy. Supports OA SSO auto-login for seamless token management.',
  enabled: true,
  id: 'towerai',
  modelList: { showModelFetcher: false },
  name: 'Tower AI',
  settings: {
    apiKey: {
      desc: 'Your Tower AI token. Use auto-login or paste manually from browser DevTools.',
      placeholder: 'tower-ai-token',
      title: 'Token',
    },
    proxyUrl: {
      desc: 'Tower AI service URL (default: https://tower-ai.yottastudios.com)',
      placeholder: 'https://tower-ai.yottastudios.com',
      title: 'Service URL',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://tower-ai.yottastudios.com',
};

export default TowerAI;
