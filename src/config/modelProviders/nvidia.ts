import { ModelProviderCard } from '@/types/llm';

const Nvidia: ModelProviderCard = {
  chatModels: [],
  checkModel: 'meta/llama-3.2-1b-instruct',
  description:
    'NVIDIA NIM™ 提供容器，可用于自托管 GPU 加速推理微服务，支持在云端、数据中心、RTX™ AI 个人电脑和工作站上部署预训练和自定义 AI 模型。',
  id: 'nvidia',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://build.nvidia.com/models',
  name: 'Nvidia NIM',
  settings: {
    disableBrowserRequest: true, // CORS error
    proxyUrl: {
      placeholder: 'https://integrate.api.nvidia.com/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://build.nvidia.com',
};

export default Nvidia;
