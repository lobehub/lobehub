import type { ModelProviderCard } from '@/types/llm';

const Jina: ModelProviderCard = {
  chatModels: [],
  checkModel: 'jina-deepsearch-v1',
  description:
    'Founded in 2020, Jina AI is a leading search AI company. Its search stack includes vector models, rerankers, and small language models to build reliable, high-quality generative and multimodal search apps.',
  id: 'jina',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://jina.ai/models',
  name: 'Jina AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://deepsearch.jina.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://jina.ai',
};

export default Jina;
