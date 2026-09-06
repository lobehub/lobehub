import type { ModelProviderCard } from '@/types/llm';

// Kevoryn — AI API Gateway, 66+ models with one key
// https://kevoryn.com
const Kevoryn: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-pro',
  description:
    'Kevoryn is an AI API gateway providing unified access to 66+ frontier models (GPT-5.5, Claude Opus 4.8, Gemini 3.1 Pro, DeepSeek V4, Kimi K2.6, Qwen 3.6, MiniMax M2.7) through a single OpenAI-compatible endpoint. Supports direct access from China without a VPN, with WeChat/Alipay payment.',
  enabled: true,
  id: 'kevoryn',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://kevoryn.com/models',
  name: 'Kevoryn',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.kevoryn.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://kevoryn.com',
};

export default Kevoryn;
