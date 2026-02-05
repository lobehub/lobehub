import type { ModelProviderCard } from '@/types/llm';

const BaiduWenxin: ModelProviderCard = {
  chatModels: [],
  checkModel: 'ernie-4.5-turbo-latest',
  description:
    'An enterprise all-in-one platform for foundation models and AI-native app development, offering end-to-end tooling for generative AI model and application workflows.',
  id: 'wenxin',
  modelsUrl: 'https://console.bce.baidu.com/qianfan/modelcenter/model/buildIn/list',
  name: 'Wenxin',
  settings: {
    proxyUrl: {
      placeholder: 'https://qianfan.baidubce.com/v2',
    },
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
  },
  url: 'https://cloud.baidu.com/wenxin.html',
};

export default BaiduWenxin;
