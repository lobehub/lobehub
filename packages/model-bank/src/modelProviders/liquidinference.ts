import type { ModelProviderCard } from '../types';

// ref: https://liquidinference.ai/docs
const LiquidInference: ModelProviderCard = {
  chatModels: [],
  checkModel: 'liquid.auto',
  description:
    'Liquid Inference is an auction exchange for LLM inference. Providers post standing offers, and each request goes to the cheapest eligible offer, with a price cap fixed before the first token and a charge for the tokens used.',
  id: 'liquidinference',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://liquidinference.ai/docs/market',
  name: 'Liquid Inference',
  settings: {
    proxyUrl: {
      placeholder: 'https://router.inference.ai.exchange/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://liquidinference.ai',
};

export default LiquidInference;
