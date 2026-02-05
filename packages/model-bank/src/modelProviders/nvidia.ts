import type { ModelProviderCard } from '@/types/llm';

const Nvidia: ModelProviderCard = {
  chatModels: [],
  checkModel: 'meta/llama-3.2-1b-instruct',
  description:
    'NVIDIA NIM provides containers for self-hosted, GPU-accelerated inference microservices across cloud, data centers, RTX AI PCs, and workstations for pre-trained and custom models.',
  id: 'nvidia',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://build.nvidia.com/models',
  name: 'Nvidia',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://integrate.api.nvidia.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://build.nvidia.com',
};

export default Nvidia;
