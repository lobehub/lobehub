import type { ModelProviderCard } from '@/types/llm';

const Xinference: ModelProviderCard = {
  chatModels: [],
  description:
    'Xorbits Inference (Xinference) is an open-source platform that simplifies running and integrating AI models. It lets you run open-source LLMs, embedding models, and multimodal models locally or in the cloud to build powerful AI apps.',
  id: 'xinference',
  modelsUrl: 'https://inference.readthedocs.io/zh-cn/latest/models/builtin/index.html',
  name: 'Xinference',
  settings: {
    proxyUrl: {
      placeholder: 'http://localhost:9997/v1',
    },
    sdkType: 'openai',
  },
  url: 'https://inference.readthedocs.io/zh-cn/v0.12.3/index.html',
};

export default Xinference;
