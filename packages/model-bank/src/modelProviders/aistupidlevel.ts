import type { ModelProviderCard } from '../types';

// ref: https://aistupidlevel.info/router/docs
const AIStupidLevel: ModelProviderCard = {
  chatModels: [],
  checkModel: 'auto-best',
  description:
    'AI Stupid Level is an OpenAI-compatible router: each routing mode sends a request to the model that scores best for that kind of task on its benchmarks, called with your own provider keys.',
  id: 'aistupidlevel',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://aistupidlevel.info/router/docs#strategies',
  name: 'AI Stupid Level',
  settings: {
    proxyUrl: {
      placeholder: 'https://aistupidlevel.info/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://aistupidlevel.info/router',
};

export default AIStupidLevel;
