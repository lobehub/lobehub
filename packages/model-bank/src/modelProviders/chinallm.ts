import type { ModelProviderCard } from '@/types/llm';

const ChinaLLM: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-pro',
  description:
    'ChinaLLM aggregates 20+ Chinese AI models behind a single OpenAI-compatible API — at a fraction of OpenAI prices. Access DeepSeek, Qwen, GLM, Kimi, MiniMax, Moonshot and more with USDT or PayPal.',
  enabled: true,
  id: 'chinallm',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://chinallm.dev',
  name: 'ChinaLLM',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.chinallm.dev/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://chinallm.dev',
};

export default ChinaLLM;
