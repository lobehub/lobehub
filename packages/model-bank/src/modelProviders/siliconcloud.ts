import type { ModelProviderCard } from '@/types/llm';

// ref: https://siliconflow.cn/zh-cn/pricing
const SiliconCloud: ModelProviderCard = {
  chatModels: [],
  checkModel: 'Pro/zai-org/glm-4.7',
  description:
    'SiliconCloud is a cost-effective GenAI cloud service built on strong open-source base models.',
  id: 'siliconcloud',
  modelList: { showModelFetcher: true },
  modelsUrl: 'https://siliconflow.cn/zh-cn/models',
  name: 'SiliconCloud',
  settings: {
    proxyUrl: {
      placeholder: 'https://api.siliconflow.cn/v1',
    },
    sdkType: 'openai',
    showModelFetcher: true,
  },
  url: 'https://siliconflow.cn/zh-cn/siliconcloud',
};

export default SiliconCloud;
