import type { ModelProviderCard } from '../types';

const FlexAI: ModelProviderCard = {
  apiKeyUrl: 'https://tokens.flex.ai',
  chatModels: [],
  checkModel: 'Llama-3.3-70B-Instruct-FP8',
  description:
    'FlexAI serves open-weight models through an OpenAI-compatible API, with chat, vision, embedding, image, speech and transcription endpoints behind a single key.',
  id: 'flexai',
  modelsUrl: 'https://flex.ai/models',
  name: 'FlexAI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.flex.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://flex.ai',
};

export default FlexAI;
