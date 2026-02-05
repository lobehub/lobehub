import type { ModelProviderCard } from '@/types/llm';

// ref: https://ollama.com/library
const LMStudio: ModelProviderCard = {
  chatModels: [],
  description:
    'LM Studio is a desktop app for developing and experimenting with LLMs on your computer.',
  id: 'lmstudio',
  modelsUrl: 'https://lmstudio.ai/models',
  name: 'LM Studio',
  settings: {
    defaultShowBrowserRequest: true,
    proxyUrl: {
      placeholder: 'http://127.0.0.1:1234/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    showApiKey: false,
    showModelFetcher: true,
  },
  url: 'https://lmstudio.ai',
};

export default LMStudio;
