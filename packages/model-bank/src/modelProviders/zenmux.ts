import type { ModelProviderCard } from '@/types/llm';

const ZenMux: ModelProviderCard = {
  chatModels: [],
  checkModel: 'openai/gpt-5-nano',
  description:
    'ZenMux is a unified AI aggregation platform that supports OpenAI, Anthropic, Google VertexAI, and more, with flexible routing to switch and manage models easily.',
  id: 'zenmux',
  name: 'ZenMux',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://zenmux.ai',
    },
    sdkType: 'router',
    showModelFetcher: true,
  },
  url: 'https://zenmux.ai',
};

export default ZenMux;
