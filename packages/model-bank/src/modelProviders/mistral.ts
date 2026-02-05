import type { ModelProviderCard } from '@/types/llm';

// ref: https://docs.mistral.ai/getting-started/models/
// ref: https://docs.mistral.ai/capabilities/function_calling/
const Mistral: ModelProviderCard = {
  chatModels: [],
  checkModel: 'ministral-3b-latest',
  description:
    'Mistral offers advanced general, specialized, and research models for complex reasoning, multilingual tasks, and code generation, with function-calling for custom integrations.',
  id: 'mistral',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://docs.mistral.ai/getting-started/models',
  name: 'Mistral',
  settings: {
    disableBrowserRequest: true, // CORS Error
    proxyUrl: {
      placeholder: 'https://api.mistral.ai',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://mistral.ai',
};

export default Mistral;
