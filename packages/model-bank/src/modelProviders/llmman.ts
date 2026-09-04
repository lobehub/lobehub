import type { ModelProviderCard } from '../types';

// llmman serves an OpenAI-compatible API at /v1, alongside Ollama- and
// Anthropic-compatible ones. Models are whatever the user has pulled locally,
// so the model list is fetched from the running server.
const Llmman: ModelProviderCard = {
  chatModels: [],
  description:
    'llmman is a command-line tool for running and serving local models, distributed as OCI artifacts.',
  id: 'llmman',
  modelsUrl: 'https://github.com/llmmanorg/llmman',
  name: 'llmman',
  settings: {
    defaultShowBrowserRequest: true,
    proxyUrl: {
      placeholder: 'http://127.0.0.1:17434/v1',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    showModelFetcher: true,
  },
  url: 'https://github.com/llmmanorg/llmman',
};

export default Llmman;
