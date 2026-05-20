import type { ModelProviderCard } from '@/types/llm';

// ref: https://manifest.build
const Manifest: ModelProviderCard = {
  chatModels: [],
  description:
    'Manifest is an open-source LLM router that automatically selects the best model across 16+ providers based on request complexity, with built-in fallback chains.',
  id: 'manifest',
  modelList: { showModelFetcher: true },
  name: 'Manifest',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://app.manifest.build/v1',
    },
    sdkType: 'openai',
    searchMode: 'params',
    showModelFetcher: true,
  },
  url: 'https://manifest.build',
};

export default Manifest;
