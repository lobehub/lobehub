import type { ModelProviderCard } from '@/types/llm';

// ref: https://www.xfyun.cn/doc/spark/HTTP%E8%B0%83%E7%94%A8%E6%96%87%E6%A1%A3.html#_3-%E8%AF%B7%E6%B1%82%E8%AF%B4%E6%98%8E
// ref: https://www.xfyun.cn/doc/spark/Web.html#_1-%E6%8E%A5%E5%8F%A3%E8%AF%B4%E6%98%8E
const Spark: ModelProviderCard = {
  chatModels: [],
  checkModel: 'lite',
  description:
    'iFLYTEK Spark provides powerful multilingual AI across domains, enabling innovations in smart hardware, healthcare, finance, and other verticals.',
  id: 'spark',
  modelsUrl: 'https://xinghuo.xfyun.cn/spark',
  name: 'Spark',
  settings: {
    disableBrowserRequest: true,
    responseAnimation: {
      speed: 2,
      text: 'smooth',
    },
    sdkType: 'openai',
    showModelFetcher: false,
  },
  url: 'https://www.xfyun.cn',
};

export default Spark;
