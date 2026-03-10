import type { ModelProviderCard } from '@/types/llm';

// ref https://www.volcengine.com/docs/82379/1330310
const Doubao: ModelProviderCard = {
  chatModels: [],
  checkModel: 'doubao-seed-1.8',
  description:
    'ByteDance’s model service platform offers secure, feature-rich, cost-competitive model access plus end-to-end tooling for data, fine-tuning, inference, and evaluation.',
  id: 'volcengine',
  modelsUrl: 'https://www.volcengine.com/docs/82379/1330310',
  name: 'Volcengine',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://ark.cn-beijing.volces.com/api/v3',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showDeployName: true,
    showModelFetcher: false,
  },
  url: 'https://www.volcengine.com/product/ark',
};

export default Doubao;
