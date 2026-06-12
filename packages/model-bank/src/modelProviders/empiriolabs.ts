import type { ModelProviderCard } from '@/types/llm';

import { default as empiriolabsModels } from '../aiModels/empiriolabs';

// ref: https://empiriolabs.ai/models
const EmpirioLabs: ModelProviderCard = {
  chatModels: empiriolabsModels,
  checkModel: 'gemma-4-26b-a4b',
  description:
    'EmpirioLabs AI hosts open, proprietary, and custom models (Qwen, DeepSeek, GLM, Kimi, MiniMax, Gemma, and more) behind one OpenAI-compatible API with pay-as-you-go pricing.',
  id: 'empiriolabs',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://empiriolabs.ai/models',
  name: 'EmpirioLabs',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.empiriolabs.ai/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://empiriolabs.ai',
};

export default EmpirioLabs;
