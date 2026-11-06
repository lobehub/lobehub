import type { ModelProviderCard } from '@/types/llm';

import { empiriolabsChatModelList } from '../aiModels/empiriolabs';

// ref: https://empiriolabs.ai/models
const EmpirioLabs: ModelProviderCard = {
  chatModels: empiriolabsChatModelList,
  checkModel: 'gemma-4-26b-a4b',
  description:
    'EmpirioLabs AI is specialized AI model hosting for open, proprietary, and custom stacks.',
  id: 'empiriolabs',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://empiriolabs.ai/models',
  name: 'EmpirioLabs AI',
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
