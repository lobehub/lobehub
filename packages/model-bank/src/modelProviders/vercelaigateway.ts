import type { ModelProviderCard } from '@/types/llm';

const VercelAIGateway: ModelProviderCard = {
  apiKeyUrl: 'https://vercel.com/dashboard/ai-gateway',
  chatModels: [],
  checkModel: 'openai/gpt-5-nano',
  description:
    'Vercel AI Gateway provides a unified API for 100+ models across OpenAI, Anthropic, Google, and more, with budgeting, usage monitoring, load balancing, and failover.',
  id: 'vercelaigateway',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://vercel.com/ai-gateway/models',
  name: 'Vercel AI Gateway',
  settings: {
    disableBrowserRequest: true, // CORS error
    responseAnimation: 'smooth',
    showModelFetcher: true,
  },
  url: 'https://vercel.com/ai-gateway',
};

export default VercelAIGateway;
