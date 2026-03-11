import type { ModelProviderCard } from '@/types/llm';

const DeepSeek: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-chat',
  description:
    'DeepSeek focuses on AI research and applications; its latest DeepSeek-V3 benchmarks surpass open models like Qwen2.5-72B and Llama-3.1-405B, aligning with leading closed models such as GPT-4o and Claude-3.5-Sonnet.',
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
