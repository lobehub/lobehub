import type { ModelProviderCard } from '@/types/llm';

// Kevoryn — AI API Gateway, one key for 80+ frontier models
// https://kevoryn.com
const Kevoryn: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v4-pro',
  description:
    'Kevoryn is an AI API gateway providing unified access to 80+ frontier models (Claude, GPT, Gemini, Grok, DeepSeek, Kimi, GLM, Qwen, MiniMax and more) through a single endpoint. It keeps the native OpenAI, Anthropic and Gemini protocols, bills pay-as-you-go with no subscription, supports direct access from mainland China, and accepts WeChat/Alipay payment.',
  enabled: true,
  id: 'kevoryn',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://kevoryn.com/model-plaza',
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
