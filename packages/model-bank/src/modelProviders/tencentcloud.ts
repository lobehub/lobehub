import type { ModelProviderCard } from '@/types/llm';

const TencentCloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'deepseek-v3',
  description:
    'LLM Knowledge Engine Atomic Power provides end-to-end knowledge QA for enterprises and developers, with modular services like document parsing, chunking, embeddings, and multi-turn rewriting to assemble custom AI solutions.',
  id: 'tencentcloud',
  modelsUrl: 'https://cloud.tencent.com/document/api/1772/115963',
  name: 'TencentCloud',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://api.lkeap.cloud.tencent.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://cloud.tencent.com/document/api/1772/115365',
};

export default TencentCloud;
