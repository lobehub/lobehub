import type { ModelProviderCard } from '../types';

// ref: https://cheaperinference.com/docs
const CheaperInference: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-5.4-mini',
  description:
    'Cheaper Inference is an OpenAI-compatible gateway that gives access to models from many labs with one API key. Each model costs 15–60% less than the list price of its lab.',
  id: 'cheaperinference',
  modelsUrl: 'https://cheaperinference.com/#models',
  name: 'Cheaper Inference',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.cheaperinference.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://cheaperinference.com',
};

export default CheaperInference;
