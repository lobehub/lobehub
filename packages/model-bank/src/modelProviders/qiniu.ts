import type { ModelProviderCard } from '@/types/llm';

// ref: https://developer.qiniu.com/aitokenapi
const Qiniu: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-r1',
  description:
    'Qiniu provides reliable, cost-effective real-time and batch AI inference services that are easy to use.',
  id: 'qiniu',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://developer.qiniu.com/aitokenapi/12882/ai-inference-api',
  name: 'Qiniu',
  settings: {
    proxyUrl: {
      placeholder: 'https://openai.qiniu.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.qiniu.com',
};

export default Qiniu;
