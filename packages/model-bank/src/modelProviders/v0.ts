import type { ModelProviderCard } from '@/types/llm';

const V0: ModelProviderCard = {
  chatModels: [],
  checkModel: 'v0-1.5-md',
  description:
    'v0 is a pair-programming assistant that turns natural-language ideas into code and UI for your project.',
  id: 'v0',
  modelsUrl: 'https://vercel.com/docs/v0/api#models',
  name: 'Vercel (v0)',
  settings: {
    disableBrowserRequest: true, // CORS error
    sdkType: 'openai',
  },
  url: 'https://v0.dev',
};

export default V0;
