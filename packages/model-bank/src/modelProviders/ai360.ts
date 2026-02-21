import type { ModelProviderCard } from '@/types/llm';

// ref: https://ai.360.cn/platform/docs/overview
const Ai360: ModelProviderCard = {
  chatModels: [],
  checkModel: '360gpt-turbo',
  description:
    '360 AI is a model and service platform from 360, offering NLP models like 360GPT2 Pro, 360GPT Pro, and 360GPT Turbo. The models combine large-scale parameters and multimodal capabilities for text generation, semantic understanding, chat, and code, with flexible pricing for diverse needs.',
  disableBrowserRequest: true,
  id: 'ai360',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://ai.360.cn/platform/docs/overview',
  name: '360 AI',
  settings: {
    disableBrowserRequest: true,
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://ai.360.com',
};

export default Ai360;
