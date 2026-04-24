import type { ModelProviderCard } from '@/types/llm';

const DeepSeek: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-flash',
  description:
    'DeepSeek focuses on AI research and applications. Its latest DeepSeek V4 family ships in Flash and Pro variants with a 1M context window and hybrid thinking — competitive with leading closed frontier models on reasoning and agent benchmarks.',
  id: 'deepseek',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://platform.deepseek.com/api-docs/zh-cn/quick_start/pricing',
  name: 'DeepSeek',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.deepseek.com',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://deepseek.com',
};

export default DeepSeek;
