import type { ModelProviderCard } from '../types';

// ref: https://y-api.bestvirtualgoods.com/pricing
const YAPI: ModelProviderCard = {
  apiKeyUrl: 'https://y-api.bestvirtualgoods.com/app/keys',
  chatModels: [],
  checkModel: 'deepseek/deepseek-v4-flash',
  description:
    'Y-API is an OpenAI-compatible relay that exposes DeepSeek, Moonshot AI, OpenAI, Tencent, Xiaomi, and Z.ai models through a single endpoint, with a free tier and pay-per-token pricing.',
  id: 'yapi',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://y-api.bestvirtualgoods.com/models',
  name: 'Y-API',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.y-api.bestvirtualgoods.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://y-api.bestvirtualgoods.com',
};

export default YAPI;
