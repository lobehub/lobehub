import type { ModelProviderCard } from '@/types/llm';

// ref: https://ai.gitee.com/serverless-api/packages/1910
const GiteeAI: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Qwen2.5-72B-Instruct',
  description:
    'Gitee AI Serverless APIs provide plug-and-play LLM inference services for developers.',
  disableBrowserRequest: true,
  id: 'giteeai',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://ai.gitee.com/docs/openapi/v1#tag/serverless/POST/chat/completions',
  name: 'Gitee AI',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://ai.gitee.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://ai.gitee.com',
};

export default GiteeAI;
