import type { ModelProviderCard } from '@/types/llm';

const Ollama: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-r1',
  defaultShowBrowserRequest: true,
  description:
    'Ollama offers models across code generation, math, multilingual processing, and chat, supporting both enterprise and local deployments.',
  id: 'ollama',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://ollama.com/library',
  name: 'Ollama',
  settings: {
    defaultShowBrowserRequest: true,
    sdkType: 'ollama',
    showApiKey: false,
    showModelFetcher: true,
  },
  showApiKey: false,
  url: 'https://ollama.com',
};

export default Ollama;
