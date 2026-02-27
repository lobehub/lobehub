import { type ModelProviderCard } from '@/types/llm';

const Straico: ModelProviderCard = {
  chatModels: [],
  checkModel: 'microsoft/phi-4',
  description:
    'Straico simplifies AI integration by providing a unified workspace that brings together top text, image, and audio generative AI models, empowering marketers, entrepreneurs, and enthusiasts with seamless access to diverse AI tools.',
  id: 'straico',
  modelsUrl: 'https://straico.com/multimodel/',
  name: 'Straico',
  settings: {
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://straico.com',
};

export default Straico;
