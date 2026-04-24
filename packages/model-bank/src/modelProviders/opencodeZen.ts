import type { ModelProviderCard } from '@/types/llm';

import { default as zenModels } from '../aiModels/opencodeZen';

// ref: https://opencode.ai/zen
const OpenCodeZen: ModelProviderCard = {
  chatModels: zenModels,
  checkModel: 'claude-sonnet-4-5',
  description:
    'OpenCode Zen provides access to curated models from OpenAI, Anthropic, Moonshot, MiniMax, Zhipu, Qwen, and more via a single API key.',
  id: 'opencodezen',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://opencode.ai/zen',
  name: 'OpenCode Zen',
  settings: {
    proxyUrl: {
      placeholder: 'https://opencode.ai/zen/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://opencode.ai/zen',
};

export default OpenCodeZen;
