import type { ModelProviderCard } from '../types';

// ref: https://unsloth.ai/docs/basics/api
const Unsloth: ModelProviderCard = {
  chatModels: [],
  description:
    'Unsloth is a framework for fine-tuning and running LLMs locally, exposing loaded GGUF models through an OpenAI-compatible API endpoint.',
  id: 'unsloth',
  modelsUrl: 'https://huggingface.co/unsloth',
  name: 'Unsloth',
  settings: {
    defaultShowBrowserRequest: true,
    proxyUrl: {
      placeholder: 'http://127.0.0.1:8000/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    showModelFetcher: true,
  },
  url: 'https://unsloth.ai',
};

export default Unsloth;
