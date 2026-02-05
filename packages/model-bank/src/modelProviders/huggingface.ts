import type { ModelProviderCard } from '@/types/llm';

const HuggingFace: ModelProviderCard = {
  apiKeyUrl: 'https://huggingface.co/settings/tokens',
  chatModels: [],
  checkModel: 'mistralai/Mistral-7B-Instruct-v0.2',
  description:
    'The Hugging Face Inference API offers a fast way to explore thousands of models for many tasks, giving instant access to high-performance models for prototyping and ML experimentation.',
  disableBrowserRequest: true,
  id: 'huggingface',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://huggingface.co/docs/api-inference/en/supported-models',
  name: 'HuggingFace',
  settings: {
    disableBrowserRequest: true,
    sdkType: 'huggingface',
    showModelFetcher: true,
  },
  url: 'https://huggingface.co',
};

export default HuggingFace;
