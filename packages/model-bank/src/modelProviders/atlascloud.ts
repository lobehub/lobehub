import type { ModelProviderCard } from '../types/llm';

const AtlasCloud: ModelProviderCard = {
  apiKeyUrl: 'https://www.atlascloud.ai/console?utm_source=lobehub',
  chatModels: [],
  checkModel: 'deepseek-ai/deepseek-v4-pro',
  description:
    'Atlas Cloud is a full-modal AI inference platform with one OpenAI-compatible API for LLM, image, and video (DeepSeek, Qwen, GLM, Kimi, MiniMax, and more).',
  enabled: true,
  id: 'atlascloud',
  modelsUrl: 'https://www.atlascloud.ai/?utm_source=lobehub',
  name: 'Atlas Cloud',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.atlascloud.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://www.atlascloud.ai/?utm_source=lobehub',
};

export default AtlasCloud;
