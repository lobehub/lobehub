import type { ModelProviderCard } from '@/types/llm';

// ref: https://opencode.ai/go
const OpenCodeCodingPlan: ModelProviderCard = {
  chatModels: [],
  checkModel: 'glm-5.1',
  description:
    'OpenCode Go is a $10/month subscription providing reliable access to curated open coding models: GLM, Kimi, MiMo, Qwen, MiniMax.',
  disableBrowserRequest: true,
  id: 'opencodecodingplan',
  modelList: { showModelFetcher: false },
  modelsUrl: 'https://opencode.ai/go',
  name: 'OpenCode Go',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://opencode.ai/zen/go/v1',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://opencode.ai/go',
};

export default OpenCodeCodingPlan;
