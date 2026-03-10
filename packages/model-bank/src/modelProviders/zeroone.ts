import type { ModelProviderCard } from '@/types/llm';

// ref: https://platform.lingyiwanwu.com/docs#%E6%A8%A1%E5%9E%8B%E4%B8%8E%E8%AE%A1%E8%B4%B9
const ZeroOne: ModelProviderCard = {
  chatModels: [],
  checkModel: 'yi-lightning',
  description:
    '01.AI drives a human-centered AI 2.0 revolution, using LLMs to create economic and social value and build new AI ecosystems and business models.',
  id: 'zeroone',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.lingyiwanwu.com/docs#models-and-pricing',
  name: '01.AI',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.lingyiwanwu.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.lingyiwanwu.com/',
};

export default ZeroOne;
