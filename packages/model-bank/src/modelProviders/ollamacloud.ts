import type { ModelProviderCard } from '@/types/llm';

const OllamaCloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'gpt-oss:20b',
  description:
    'Ollama Cloud provides managed inference with out-of-the-box access to the Ollama model library and OpenAI-compatible APIs.',
  id: 'ollamacloud',
  modelsUrl: 'https://ollama.com/library',
  name: 'Ollama Cloud',
  settings: {
    disableBrowserRequest: true, // CORS error
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://ollama.com/cloud',
};

export default OllamaCloud;
