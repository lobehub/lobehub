import type { ModelProviderCard } from '@/types/llm';

const InternLM: ModelProviderCard = {
  chatModels: [],
  checkModel: 'intern-latest',
  description:
    'An open-source organization focused on large-model research and tooling, providing an efficient, easy-to-use platform that makes cutting-edge models and algorithms accessible.',
  id: 'internlm',
  modelsUrl: 'https://internlm.intern-ai.org.cn/api/document',
  name: 'InternLM',
  settings: {
    disableBrowserRequest: true,
    proxyUrl: {
      placeholder: 'https://chat.intern-ai.org.cn/api/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://internlm.intern-ai.org.cn',
};

export default InternLM;
