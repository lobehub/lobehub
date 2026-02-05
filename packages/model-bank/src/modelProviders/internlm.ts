import type { ModelProviderCard } from '@/types/llm';

const InternLM: ModelProviderCard = {
  chatModels: [],
  checkModel: 'internlm2.5-latest',
  description:
    'An open-source organization focused on large-model research and tooling, providing an efficient, easy-to-use platform that makes cutting-edge models and algorithms accessible.',
  disableBrowserRequest: true,
  id: 'internlm',
  modelList: { showModelFetcher: true },
  modelsUrl:
    'https://internlm.intern-ai.org.cn/doc/docs/Models#%E8%8E%B7%E5%8F%96%E6%A8%A1%E5%9E%8B%E5%88%97%E8%A1%A8',
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
